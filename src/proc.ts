/** Spawn helpers shared by the yt-dlp and whisper.cpp wrappers. */

import { spawn } from "node:child_process";

/**
 * Diagnose common external tool failures (yt-dlp, ffmpeg, whisper.cpp) and
 * append an actionable recovery hint so callers and agents know what to do next.
 */
export function explainCommandError(command: string, code: number | null, stderr: string): string {
  const tail = stderr.trim().split("\n").slice(-6).join("\n");
  const base = `${command} exited with code ${code}${tail ? `:\n${tail}` : ""}`;
  const hints: string[] = [];

  if (/HTTP Error 429|Too Many Requests/i.test(stderr)) {
    hints.push(
      "Hint: Rate-limited by the platform (HTTP 429 Too Many Requests). " +
        "Pass browser cookies (--cookies-from-browser chrome) to use an authenticated session, " +
        "or pass --whisper-only to skip subtitle endpoints and transcribe the audio directly.",
    );
  } else if (
    /Sign in to confirm|login required|cookies|not available on this app|Private video|members-only|HTTP Error (401|403)/i.test(
      stderr,
    )
  ) {
    hints.push(
      "Hint: This video requires authentication or is access-restricted. " +
        "Retry with --cookies-from-browser chrome (or safari, firefox, edge) or --cookies <cookies.txt>.",
    );
  } else if (/Video unavailable|This video is unavailable|has been removed|account associated with this video/i.test(stderr)) {
    hints.push("Hint: The video is unavailable, deleted, or region-locked at the source URL.");
  } else if (/Unsupported URL|is not a valid URL/i.test(stderr)) {
    hints.push("Hint: The URL is not supported by yt-dlp or is malformed.");
  }

  if (/ffprobe and ffmpeg not found|ffmpeg not found|Postprocessing:.*ffmpeg/i.test(stderr)) {
    hints.push("Hint: ffmpeg is required for audio extraction/conversion. Install it with `brew install ffmpeg` (macOS) or `apt install ffmpeg` (Linux).");
  }

  return hints.length > 0 ? `${base}\n\n${hints.join("\n")}` : base;
}

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(explainCommandError(command, code, stderr));
    this.name = "CommandError";
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** A step that ran longer than its budget. Retrying it is usually worthwhile. */
export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${Math.round(ms / 1000)}s`);
    this.name = "TimeoutError";
  }
}

export interface Deadline {
  /** Cancels the step; the child process is killed. */
  signal?: AbortSignal;
  /** Fail with a TimeoutError after this long. */
  timeoutMs?: number;
}

/**
 * One signal for "the caller gave up or the step ran out of time", plus a way
 * to turn whichever fired into the right error: the caller's own abort reason,
 * or a TimeoutError naming the step.
 */
export function deadline(what: string, { signal, timeoutMs }: Deadline = {}) {
  const timer = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  const signals = [signal, timer].filter((s): s is AbortSignal => s !== undefined);
  const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  const reason = (): unknown =>
    signal?.aborted ? signal.reason : new TimeoutError(what, timeoutMs ?? 0);
  return { signal: combined, reason };
}

/**
 * Process groups of cancellable children still running. yt-dlp starts ffmpeg,
 * and killing only yt-dlp leaves ffmpeg writing into a folder a retry is
 * about to reuse, so a cancellable child gets its own group and the whole
 * group is killed. If this process exits first (a second Ctrl-C, a crash),
 * the groups go with it.
 */
const liveGroups = new Set<number>();
let exitHookInstalled = false;

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

function trackGroup(pid: number): void {
  liveGroups.add(pid);
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const group of liveGroups) killGroup(group, "SIGKILL");
  });
}

/** Run a command to completion, rejecting on a non-zero exit. */
export function run(bin: string, args: string[], limits: Deadline = {}): Promise<RunResult> {
  const { signal, reason } = deadline(bin, limits);
  // Only cancellable runs get their own group: an uncancellable one should
  // still receive the terminal's Ctrl-C along with us, as it always has.
  const ownGroup = signal !== undefined && process.platform !== "win32";

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(reason());
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], detached: ownGroup });
    const pid = child.pid;
    if (ownGroup && pid) trackGroup(pid);

    const stop = () => {
      if (ownGroup && pid) {
        killGroup(pid, "SIGTERM");
        setTimeout(() => killGroup(pid, "SIGKILL"), 3000).unref();
      } else {
        child.kill("SIGTERM");
      }
      reject(reason());
    };
    signal?.addEventListener("abort", stop, { once: true });
    const settle = () => {
      signal?.removeEventListener("abort", stop);
      if (pid) liveGroups.delete(pid);
    };

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      settle();
      reject(signal?.aborted ? reason() : error);
    });
    child.on("close", (code) => {
      settle();
      if (signal?.aborted) reject(reason());
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new CommandError(bin, code, stderr));
    });
  });
}

/** True when the binary exists and answers `--version`. */
export async function isRunnable(bin: string): Promise<boolean> {
  try {
    await run(bin, ["--version"]);
    return true;
  } catch (err) {
    // whisper.cpp builds predating --version still exist on PATH; only a
    // genuinely missing binary should count as unavailable.
    return !(err instanceof Error && "code" in err && err.code === "ENOENT");
  }
}
