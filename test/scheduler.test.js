import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createLimiter, runTasks } from "../dist/scheduler.js";

const transient = () => new Error("HTTP Error 503");
const limited = () => new Error("HTTP Error 429: Too Many Requests");
const FAST = { retryDelayMs: 10, isRetryable: (e) => /HTTP Error (429|5\d\d)/.test(e.message) };

test("never runs more than `concurrency` tasks at once", async () => {
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 8 }, (_, i) => ({
    key: `site-${i}`,
    run: async () => {
      peak = Math.max(peak, ++active);
      await sleep(15);
      active -= 1;
      return i;
    },
  }));
  const outcomes = await runTasks(tasks, { concurrency: 3 });
  assert.equal(peak, 3);
  assert.deepEqual(outcomes.map((o) => o.value), [0, 1, 2, 3, 4, 5, 6, 7], "outcomes keep input order");
});

test("retries a temporary failure and reports the attempts", async () => {
  let calls = 0;
  const events = [];
  const [outcome] = await runTasks(
    [{ key: "a", run: async () => { if (++calls < 3) throw transient(); return "done"; } }],
    { ...FAST, retries: 3, onEvent: (e) => events.push(e.type) },
  );
  assert.deepEqual(outcome, { status: "ok", value: "done", attempts: 3 });
  assert.deepEqual(events, ["start", "retry", "start", "retry", "start", "ok"]);
});

test("does not retry a permanent failure", async () => {
  let calls = 0;
  const [outcome] = await runTasks(
    [{ key: "a", run: async () => { calls += 1; throw new Error("Video unavailable"); } }],
    { ...FAST, retries: 3 },
  );
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.attempts, 1);
  assert.equal(calls, 1);
  assert.match(outcome.error.message, /Video unavailable/);
});

test("gives up after `retries` extra attempts", async () => {
  const [outcome] = await runTasks([{ key: "a", run: async () => { throw transient(); } }], { ...FAST, retries: 2 });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.attempts, 3);
});

test("one failure doesn't stop the others", async () => {
  const outcomes = await runTasks(
    [
      { key: "a", run: async () => 1 },
      { key: "b", run: async () => { throw new Error("nope"); } },
      { key: "c", run: async () => 3 },
    ],
    FAST,
  );
  assert.deepEqual(outcomes.map((o) => o.status), ["ok", "failed", "ok"]);
});

test("spaces out starts against the same key", async () => {
  const starts = [];
  const tasks = Array.from({ length: 3 }, () => ({ key: "youtube.com", run: async () => starts.push(Date.now()) }));
  await runTasks(tasks, { concurrency: 3, gapMs: 60 });
  assert.ok(starts[1] - starts[0] >= 50, `gap 1 was ${starts[1] - starts[0]}ms`);
  assert.ok(starts[2] - starts[1] >= 50, `gap 2 was ${starts[2] - starts[1]}ms`);
});

test("a rate limit cools down every queued job for that key, but not other keys", async () => {
  const starts = {};
  let first = true;
  const task = (name, key, fn) => ({ key, run: async () => { (starts[name] ??= []).push(Date.now()); return fn(); } });
  const t0 = Date.now();
  await runTasks(
    [
      task("a", "yt", () => { if (first) { first = false; throw limited(); } }),
      task("b", "yt", () => {}),
      task("c", "tiktok", () => {}),
    ],
    {
      concurrency: 1,
      retryDelayMs: 20,
      isRetryable: () => true,
      isRateLimited: (e) => /429/.test(e.message),
    },
  );
  // A rate limit backs off 6x the base delay (120ms, ±25% jitter) for the whole key.
  assert.ok(starts.b[0] - t0 >= 85, `b started ${starts.b[0] - t0}ms in, inside the cooldown`);
  assert.ok(starts.c[0] < starts.b[0], "another site must not wait out yt's cooldown");
  assert.equal(starts.a.length, 2);
});

test("a job waiting to retry doesn't hold a worker slot", async () => {
  const order = [];
  let failed = false;
  await runTasks(
    [
      { key: "a", run: async () => { if (!failed) { failed = true; throw transient(); } order.push("a"); } },
      { key: "b", run: async () => order.push("b") },
    ],
    { concurrency: 1, retryDelayMs: 40, isRetryable: () => true },
  );
  assert.deepEqual(order, ["b", "a"]);
});

test("abort stops scheduling, cancels running work, and reports what didn't finish", async () => {
  const controller = new AbortController();
  const tasks = Array.from({ length: 4 }, (_, i) => ({
    key: `k${i}`,
    run: (signal) =>
      i === 0
        ? Promise.resolve("quick")
        : new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 5000);
            signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); });
          }),
  }));
  setTimeout(() => controller.abort(new Error("stop")), 50);
  const started = Date.now();
  const outcomes = await runTasks(tasks, { concurrency: 2, signal: controller.signal });
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(outcomes.map((o) => o.status), ["ok", "interrupted", "interrupted", "interrupted"]);
  assert.equal(outcomes[3].attempts, 0, "never-started jobs report zero attempts");
});

test("abort doesn't wait for a task that ignores its signal", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  const [outcome] = await runTasks([{ key: "a", run: () => sleep(5000) }], { signal: controller.signal });
  assert.equal(outcome.status, "interrupted");
});

test("createLimiter runs at most `limit` calls at once, in order", async () => {
  const limit = createLimiter(1);
  const log = [];
  const job = (name) => limit(async () => { log.push(`${name}:in`); await sleep(10); log.push(`${name}:out`); });
  await Promise.all([job("a"), job("b"), job("c")]);
  assert.deepEqual(log, ["a:in", "a:out", "b:in", "b:out", "c:in", "c:out"]);
});

test("the per-site gap shrinks back after successes", async () => {
  const starts = [];
  let throttled = 3;
  const tasks = Array.from({ length: 8 }, () => ({
    key: "yt",
    run: async () => {
      starts.push(Date.now());
      if (throttled > 0) { throttled -= 1; throw limited(); }
    },
  }));
  await runTasks(tasks, { concurrency: 1, gapMs: 5, retryDelayMs: 5, isRetryable: () => true, isRateLimited: () => true });
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  // Three 429s widen the gap; the later successes halve it each time.
  assert.ok(gaps.at(-1) < Math.max(...gaps) / 2, `gaps ${gaps.join(",")}ms never recovered`);
});

test("invalid options throw instead of silently doing nothing", async () => {
  await assert.rejects(runTasks([], { concurrency: Number.NaN }), RangeError);
  await assert.rejects(runTasks([], { concurrency: 0 }), RangeError);
  await assert.rejects(runTasks([], { retries: -1 }), RangeError);
});
