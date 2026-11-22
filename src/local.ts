/**
 * Video and audio files on this computer. They skip yt-dlp entirely: ffmpeg
 * pulls the audio track out and Whisper transcribes it.
 */

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CommandError, type Deadline, run } from "./proc.js";
import type { VideoInfo } from "./types.js";
import { InvalidUrlError, tidyInput } from "./url.js";

// Something that can only be a path: /x, ./x, ../x, ~/x, C:\x or file://x.
const PATH_LIKE = /^(?:\/|\.{1,2}[/\\]|~(?:[/\\]|$)|[a-z]:[/\\]|file:)/i;

/** The absolute path `input` names, with `~` and `file://` resolved. */
export function toPath(input: string): string {
  let path = tidyInput(input);
  if (/^file:/i.test(path)) {
    try {
      path = fileURLToPath(path);
    } catch {
      throw new InvalidUrlError(input, "it isn't a usable file:// link");
    }
  }
  if (path === "~" || /^~[/\\]/.test(path)) path = homedir() + path.slice(1);
  return isAbsolute(path) ? path : resolve(path);
}

/** True when `input` names an existing file, or could only be meant as a path. */
export function looksLikeFile(input: string): boolean {
  const tidy = tidyInput(input);
  if (!tidy) return false;
  if (PATH_LIKE.test(tidy)) return true;
  try {
    return existsSync(toPath(input));
  } catch {
    return false;
  }
}

/**
 * The absolute path of the media file `input` names, or null when `input` is
 * meant as a web link. Throws {@link InvalidUrlError} for a path that is
 * missing, is a folder, or can't be read.
 */
export async function localMediaPath(input: string): Promise<string | null> {
  if (!looksLikeFile(input)) return null;

  const path = toPath(input);
  // A path dragged into a terminal arrives as `My\ Movie.mov`.
  const candidates = path.includes("\\ ") ? [path, path.replace(/\\ /g, " ")] : [path];

  let lastError: NodeJS.ErrnoException | undefined;
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) throw new InvalidUrlError(input, "it is a folder; give one video or audio file");
      if (!info.isFile()) throw new InvalidUrlError(input, "it isn't a regular file");
      if (info.size === 0) throw new InvalidUrlError(input, "the file is empty");
      return candidate;
    } catch (error) {
      if (error instanceof InvalidUrlError) throw error;
      lastError = error as NodeJS.ErrnoException;
    }
  }

  if (lastError?.code === "EPERM" || lastError?.code === "EACCES") {
    throw new InvalidUrlError(
      input,
      "this program isn't allowed to read that file. On macOS, allow your terminal or app under " +
        "System Settings > Privacy & Security > Files and Folders, or move the file somewhere else",
    );
  }
  throw new InvalidUrlError(input, `there is no file at ${path}`);
}

/** What the rest of the pipeline needs to know about a local file. */
export function localInfo(path: string, duration: number | null): VideoInfo {
  return {
    id: "",
    title: basename(path, extname(path)) || basename(path),
    uploader: null,
    duration,
    webpageUrl: pathToFileURL(path).href,
    extractor: "file",
  };
}

function ffmpegBinary(explicit?: string): string {
  return explicit || process.env.ANYTRANSCRIPT_FFMPEG || "ffmpeg";
}

/** Seconds from ffmpeg's `Duration: 00:01:23.45` line, or null. */
export function parseDuration(stderr: string): number | null {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/**
 * Pull the audio track out of a local file: a 16 kHz mono WAV for whisper.cpp,
 * or a small mono MP3 for a hosted backend (they cap uploads at 25 MB, which
 * 64 kbit/s keeps under for about 50 minutes).
 */
export async function extractAudio(
  input: string,
  outBase: string,
  kind: "wav16" | "mp3",
  { ffmpegPath, ...limits }: Deadline & { ffmpegPath?: string } = {},
): Promise<{ path: string; duration: number | null }> {
  const bin = ffmpegBinary(ffmpegPath);
  const out = `${outBase}.${kind === "wav16" ? "wav" : "mp3"}`;
  const codec =
    kind === "wav16"
      ? ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"]
      : ["-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k"];

  try {
    const { stderr } = await run(
      bin,
      ["-nostdin", "-hide_banner", "-nostats", "-y", "-i", input, "-vn", "-map", "0:a:0", ...codec, out],
      limits,
    );
    return { path: out, duration: parseDuration(stderr) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "ffmpeg not found. It reads the audio out of video files. Install it with " +
          "`brew install ffmpeg` (macOS) or `apt install ffmpeg` (Linux).",
      );
    }
    if (error instanceof CommandError && /matches no streams|does not contain any stream/i.test(error.stderr)) {
      throw new Error(`${basename(input)} has no audio track, so there is nothing to transcribe.`);
    }
    if (error instanceof CommandError && /Invalid data found when processing input/i.test(error.stderr)) {
      throw new Error(`${basename(input)} isn't a video or audio file ffmpeg can read.`);
    }
    throw error;
  }
}
