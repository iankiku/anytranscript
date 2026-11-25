/**
 * The video itself, and still frames from it: for studying how a video looks
 * (layout, type, colour, pacing), not what is said in it.
 */

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { mediaName } from "./batch.js";
import { ffmpegBinary, ffmpegError, localInfo, localMediaPath, parseDuration } from "./local.js";
import { CommandError, type Deadline, run } from "./proc.js";
import type { AuthOptions, VideoInfo } from "./types.js";
import { parseVideoUrl } from "./url.js";
import { downloadVideo, getInfo, resolveYtDlp } from "./ytdlp.js";

/** One still: the JPEG, and where it sits in the video, in seconds. */
export interface Frame {
  file: string;
  time: number | null;
}

export interface FrameOptions extends Deadline {
  /** One frame every this many seconds. Without it, one frame per scene change. */
  every?: number;
  /** Stop after this many frames. Defaults to 60. */
  maxFrames?: number;
  /** How different a frame must be from the last to count as a new scene, 0 to 1. Defaults to 0.3. */
  sceneThreshold?: number;
  /** Override the ffmpeg binary. */
  ffmpegPath?: string;
}

export interface SaveVideoOptions extends AuthOptions, Omit<FrameOptions, "every"> {
  /** Folder for the video and its frames. Defaults to `videos`. */
  dir?: string;
  /** Also save still frames, one per scene change. */
  frames?: boolean;
  /** Save one frame every this many seconds instead. Implies `frames`. */
  every?: number;
  /** Override the yt-dlp binary instead of letting it be resolved. */
  ytdlpPath?: string;
  /** Called with human-readable progress lines. */
  onProgress?: (message: string) => void;
}

export interface SavedVideo {
  /** The video file. For a file on this computer, the file itself: it isn't copied. */
  video: string;
  info: VideoInfo;
  /** The folder of frames and their `frames.json`, when frames were asked for. */
  framesDir?: string;
  frames?: Frame[];
}

const FRAME_FILE = /^frame-\d{4}\.jpg$/;

/**
 * Save still frames from `video` into `outDir` as `frame-0001.jpg`..., plus a
 * `frames.json` naming each frame's time, so a frame can be matched to the
 * transcript. The first frame is always kept.
 */
export async function extractFrames(
  video: string,
  outDir: string,
  { every, maxFrames = 60, sceneThreshold = 0.3, ffmpegPath, ...limits }: FrameOptions = {},
): Promise<{ dir: string; frames: Frame[]; duration: number | null }> {
  await mkdir(outDir, { recursive: true });
  // Frames left from an earlier run would be listed as this run's.
  for (const name of await readdir(outDir)) if (FRAME_FILE.test(name)) await rm(join(outDir, name), { force: true });

  const filter = every
    ? `fps=1/${every},showinfo`
    : `select='eq(n\\,0)+gt(scene\\,${sceneThreshold})',showinfo`;
  const args = (sync: string[]) => [
    "-nostdin", "-hide_banner", "-nostats", "-y", "-i", video, "-vf", filter, ...sync,
    "-frames:v", String(maxFrames), "-q:v", "2", join(outDir, "frame-%04d.jpg"),
  ];

  const bin = ffmpegBinary(ffmpegPath);
  let stderr: string;
  try {
    ({ stderr } = await run(bin, args(["-fps_mode", "vfr"]), limits));
  } catch (error) {
    // ffmpeg before 5.1 (Ubuntu 22.04 ships 4.4) only knows the older name.
    if (!(error instanceof CommandError && /Unrecognized option 'fps_mode'/.test(error.stderr))) {
      throw ffmpegError(error, video);
    }
    try {
      ({ stderr } = await run(bin, args(["-vsync", "vfr"]), limits));
    } catch (retryError) {
      throw ffmpegError(retryError, video);
    }
  }

  const times = [...stderr.matchAll(/pts_time:\s*(-?\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const names = (await readdir(outDir)).filter((name) => FRAME_FILE.test(name)).sort();
  const frames = names.map((name, i) => ({ file: join(outDir, name), time: times[i] ?? null }));
  if (frames.length === 0) throw new Error(`${basename(video)} has no picture, so there are no frames to save.`);

  const index = {
    video,
    mode: every ? `one every ${every}s` : "scene changes",
    frames: frames.map((frame) => ({ file: basename(frame.file), time: frame.time })),
  };
  await writeFile(join(outDir, "frames.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return { dir: outDir, frames, duration: parseDuration(stderr) };
}

/**
 * Save a video from any link yt-dlp reaches, and optionally still frames from
 * it. A file on this computer isn't copied; only its frames are saved.
 *
 * @example
 * const { video, frames } = await saveVideo(url, { dir: "refs", frames: true });
 */
export async function saveVideo(input: string, options: SaveVideoOptions = {}): Promise<SavedVideo> {
  const file = await localMediaPath(input);
  const url = file ?? parseVideoUrl(input);
  const {
    dir: requestedDir = "videos",
    frames: wantFrames = false,
    every,
    maxFrames,
    sceneThreshold,
    ytdlpPath,
    ffmpegPath,
    onProgress = () => {},
    signal,
    timeoutMs,
    cookiesFromBrowser,
    cookiesFile,
  } = options;
  const limits = { signal, timeoutMs };
  const auth = { cookiesFromBrowser, cookiesFile };
  const dir = resolve(requestedDir);

  let video: string;
  let info: VideoInfo;
  if (file) {
    video = file;
    info = localInfo(file, null);
    onProgress(`file: ${file}`);
  } else {
    const bin = await resolveYtDlp(ytdlpPath, onProgress);
    signal?.throwIfAborted();
    info = await getInfo(bin, url, auth, limits);
    onProgress(`${info.extractor}: "${info.title}"${info.uploader ? ` (${info.uploader})` : ""}`);
    onProgress("downloading the video...");
    video = await downloadVideo(bin, url, dir, mediaName(info, url), auth, limits);
    onProgress(`saved the video to ${video}`);
  }

  if (!wantFrames && every === undefined) return { video, info };

  onProgress(every ? `saving one frame every ${every}s...` : "saving a frame at each scene change...");
  const framesDir = join(dir, `${mediaName(info, url)}-frames`);
  const result = await extractFrames(video, framesDir, { every, maxFrames, sceneThreshold, ffmpegPath, ...limits });
  if (file && result.duration !== null) info = localInfo(file, result.duration);
  onProgress(`saved ${result.frames.length} frames to ${framesDir}`);
  return { video, info, framesDir, frames: result.frames };
}
