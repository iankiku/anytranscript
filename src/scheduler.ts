/**
 * A small in-process job scheduler for bulk runs. It exists because looping
 * over URLs fails in predictable ways: a burst of requests to one site earns
 * an HTTP 429, one flaky request kills the whole run, and parallel Whisper
 * runs fight over the same CPU. So it does four things and no more:
 *
 *   - caps how many jobs run at once;
 *   - spaces out starts against the same site, and widens that gap when the
 *     site rate-limits us;
 *   - retries failures the caller marks as temporary, with jittered
 *     exponential backoff, without holding a worker slot while it waits;
 *   - stops cleanly on an abort signal, reporting what never finished.
 */

export interface Task<T> {
  /** Jobs that share a key are spaced out and cooled down together (e.g. a site). */
  key: string;
  run: (signal: AbortSignal) => Promise<T>;
}

export type TaskOutcome<T> =
  | { status: "ok"; value: T; attempts: number }
  | { status: "failed"; error: Error; attempts: number }
  | { status: "interrupted"; attempts: number };

export type SchedulerEvent =
  | { type: "start"; index: number; attempt: number }
  | { type: "retry"; index: number; attempt: number; delayMs: number; error: Error }
  | { type: "ok"; index: number; attempts: number }
  | { type: "failed"; index: number; attempts: number; error: Error };

export interface SchedulerOptions {
  /** Jobs running at once. Default 3. */
  concurrency?: number;
  /** Extra attempts after the first, for retryable errors only. Default 3. */
  retries?: number;
  /** Minimum time between two job starts with the same key. Default 0. */
  gapMs?: number;
  /** First retry waits about this long; each later one doubles it. Default 5 s. */
  retryDelayMs?: number;
  /** Ceiling for any single wait. Default 5 min. */
  maxDelayMs?: number;
  /** Which errors are worth another attempt. Default: none. */
  isRetryable?: (error: Error) => boolean;
  /** Errors that mean the whole key is being throttled, not just this job. */
  isRateLimited?: (error: Error) => boolean;
  signal?: AbortSignal;
  onEvent?: (event: SchedulerEvent) => void;
}

interface Entry<T> {
  task: Task<T>;
  index: number;
  attempts: number;
  readyAt: number;
}

interface KeyState {
  gap: number;
  nextStart: number;
}

const toError = (value: unknown): Error => (value instanceof Error ? value : new Error(String(value)));

/**
 * Run every task and return one outcome per task, in input order. A failing
 * task never rejects the whole run; only invalid options throw.
 */
export async function runTasks<T>(tasks: Task<T>[], options: SchedulerOptions = {}): Promise<TaskOutcome<T>[]> {
  const {
    concurrency = 3,
    retries = 3,
    gapMs = 0,
    retryDelayMs = 5_000,
    maxDelayMs = 300_000,
    isRetryable = () => false,
    isRateLimited = () => false,
    signal,
    onEvent = () => {},
  } = options;

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a whole number of at least 1, got ${concurrency}`);
  }
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError(`retries must be a whole number of at least 0, got ${retries}`);
  }

  const outcomes: (TaskOutcome<T> | undefined)[] = new Array(tasks.length);
  const queue: Entry<T>[] = tasks.map((task, index) => ({ task, index, attempts: 0, readyAt: 0 }));
  const keys = new Map<string, KeyState>();
  let running = 0;

  // Workers park on this when there is nothing they can start yet; any
  // finished job, requeued retry or abort wakes them to look again.
  let wake: () => void = () => {};
  let changed = new Promise<void>((resolve) => (wake = resolve));
  const notify = () => {
    wake();
    changed = new Promise<void>((resolve) => (wake = resolve));
  };
  signal?.addEventListener("abort", notify, { once: true });

  const keyState = (key: string): KeyState => {
    let state = keys.get(key);
    if (!state) keys.set(key, (state = { gap: gapMs, nextStart: 0 }));
    return state;
  };
  const readyAt = (entry: Entry<T>) => Math.max(entry.readyAt, keyState(entry.task.key).nextStart);

  const pause = async (ms: number) => {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([changed, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
    clearTimeout(timer);
  };

  const backoff = (attempt: number, rateLimited: boolean) => {
    const base = retryDelayMs * (rateLimited ? 6 : 1) * 2 ** (attempt - 1);
    return Math.min(maxDelayMs, Math.round(base * (0.75 + Math.random() * 0.5)));
  };

  async function attempt(entry: Entry<T>): Promise<void> {
    entry.attempts += 1;
    onEvent({ type: "start", index: entry.index, attempt: entry.attempts });
    const controller = new AbortController();
    const forward = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", forward, { once: true });

    // Race the abort too, so a task that ignores its signal can't hold up shutdown.
    const aborted = new Promise<never>((_, reject) =>
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }),
    );
    const work = entry.task.run(controller.signal);
    work.catch(() => {});
    aborted.catch(() => {});

    try {
      const value = await Promise.race([work, aborted]);
      outcomes[entry.index] = { status: "ok", value, attempts: entry.attempts };
      // Ease back toward the normal gap once the site is answering again, so
      // a burst of 429s early on doesn't slow the rest of a long run.
      const state = keyState(entry.task.key);
      state.gap = Math.max(gapMs, Math.floor(state.gap / 2));
      onEvent({ type: "ok", index: entry.index, attempts: entry.attempts });
    } catch (thrown) {
      const error = toError(thrown);
      if (signal?.aborted) {
        outcomes[entry.index] = { status: "interrupted", attempts: entry.attempts };
        return;
      }
      if (entry.attempts <= retries && isRetryable(error)) {
        const limited = isRateLimited(error);
        const delayMs = backoff(entry.attempts, limited);
        const now = Date.now();
        entry.readyAt = now + delayMs;
        if (limited) {
          // Everyone queued for this site backs off, not just the job that hit it.
          const state = keyState(entry.task.key);
          state.gap = Math.min(maxDelayMs, Math.max(state.gap * 2, retryDelayMs));
          state.nextStart = Math.max(state.nextStart, entry.readyAt);
        }
        onEvent({ type: "retry", index: entry.index, attempt: entry.attempts, delayMs, error });
        queue.push(entry);
        return;
      }
      outcomes[entry.index] = { status: "failed", error, attempts: entry.attempts };
      onEvent({ type: "failed", index: entry.index, attempts: entry.attempts, error });
    } finally {
      signal?.removeEventListener("abort", forward);
    }
  }

  async function worker(): Promise<void> {
    while (!signal?.aborted) {
      if (queue.length === 0) {
        if (running === 0) return;
        await changed;
        continue;
      }

      let next = 0;
      for (let i = 1; i < queue.length; i++) {
        if (readyAt(queue[i]!) < readyAt(queue[next]!)) next = i;
      }
      const wait = readyAt(queue[next]!) - Date.now();
      if (wait > 0) {
        await pause(wait);
        continue;
      }

      const [entry] = queue.splice(next, 1);
      const state = keyState(entry!.task.key);
      state.nextStart = Date.now() + state.gap;
      running += 1;
      try {
        await attempt(entry!);
      } finally {
        running -= 1;
        notify();
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker));
  signal?.removeEventListener("abort", notify);

  // Array.from, not .map: map skips the holes left by jobs that never ran.
  return Array.from(
    outcomes,
    (outcome, index) => outcome ?? { status: "interrupted", attempts: queue.find((e) => e.index === index)?.attempts ?? 0 },
  );
}

/**
 * Let at most `limit` calls run at once, queueing the rest in order. Used to
 * keep local whisper.cpp runs from competing for the same cores.
 */
export function createLimiter(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    // A released slot is handed straight to the next waiter rather than freed,
    // so a newcomer can't slip in between and push the count over the limit.
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}
