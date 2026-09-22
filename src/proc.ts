/** Spawn helpers shared by the yt-dlp and whisper.cpp wrappers. */

import { spawn } from "node:child_process";

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly code: number | null,
    readonly stderr: string,
  ) {
    const tail = stderr.trim().split("\n").slice(-6).join("\n");
    super(`${command} exited with code ${code}${tail ? `:\n${tail}` : ""}`);
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
