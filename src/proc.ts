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

/** Run a command to completion, rejecting on a non-zero exit. */
export function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
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
