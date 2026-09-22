/** Thin yt-dlp wrapper: metadata, existing captions, and best-audio download. */

import { readdir, rm } from "node:fs/promises";
import { arch, platform } from "node:os";
import { join } from "node:path";
import { cacheDir, ensureDownloaded } from "./cache.js";
import { isRunnable, run } from "./proc.js";
import type { AuthOptions, VideoInfo } from "./types.js";

const RELEASE_BASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

/** The release asset that matches this machine. */
function releaseAsset(): string {
  switch (platform()) {
    case "darwin":
      return "yt-dlp_macos";
    case "win32":
      return "yt-dlp.exe";
    default:
      return arch() === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  }
}

/**
 * yt-dlp publishes a SHA2-256SUMS file with every release. Verifying against
 * it means a corrupted or substituted binary is rejected rather than chmod'd
 * +x and executed.
 */
async function publishedChecksum(asset: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${RELEASE_BASE}/SHA2-256SUMS`, { redirect: "follow" });
    if (!response.ok) return undefined;
    for (const line of (await response.text()).split("\n")) {
      const [digest, name] = line.trim().split(/\s+/);
      if (name === asset && digest && /^[a-f0-9]{64}$/i.test(digest)) return digest.toLowerCase();
    }
  } catch {
    // Unreachable checksums shouldn't block an otherwise working download.
  }
  return undefined;
}

let resolved: string | undefined;

/**
 * Find yt-dlp: an explicit path, then `ANYTRANSCRIPT_YTDLP`, then PATH,
 * then a copy downloaded into our cache. Resolving lazily rather than at
 * install time keeps `npm install` offline-safe while still letting `npx`
 * work on a machine that has never seen yt-dlp.
 */
export async function resolveYtDlp(
  explicit?: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  if (explicit) return explicit;
  if (process.env.ANYTRANSCRIPT_YTDLP) return process.env.ANYTRANSCRIPT_YTDLP;
  if (resolved) return resolved;

  if (await isRunnable("yt-dlp")) {
    resolved = "yt-dlp";
    return resolved;
  }

  const asset = releaseAsset();
  const sha256 = await publishedChecksum(asset);
  resolved = await ensureDownloaded(`${RELEASE_BASE}/${asset}`, cacheDir("bin", asset), {
    mode: 0o755,
    ...(sha256 ? { sha256 } : {}),
    onProgress,
    label: "yt-dlp",
  });
  return resolved;
}

function authArgs({ cookiesFromBrowser, cookiesFile }: AuthOptions): string[] {
  const args: string[] = [];
  if (cookiesFromBrowser) args.push("--cookies-from-browser", cookiesFromBrowser);
  if (cookiesFile) args.push("--cookies", cookiesFile);
  return args;
}

const BASE_ARGS = ["--no-warnings", "--no-progress", "--ignore-config"];

export async function getInfo(bin: string, url: string, auth: AuthOptions): Promise<VideoInfo> {
  const { stdout } = await run(bin, [
    ...BASE_ARGS,
    "--dump-single-json",
    "--skip-download",
    ...authArgs(auth),
    url,
  ]);

  const info = JSON.parse(stdout) as Record<string, unknown>;
  return {
    id: String(info.id ?? "unknown"),
    title: (info.title as string) || "untitled",
    uploader: (info.uploader as string) ?? null,
    duration: typeof info.duration === "number" ? info.duration : null,
    webpageUrl: (info.webpage_url as string) || url,
    extractor: (info.extractor_key as string) || (info.extractor as string) || "unknown",
  };
}

async function findFile(dir: string, matches: (name: string) => boolean): Promise<string | null> {
  const names = await readdir(dir);
  const hit = names.find(matches);
  return hit ? join(dir, hit) : null;
}

/**
 * Pull existing (human or auto-generated) captions, returning the .vtt path
 * or null when the video has none — the common case for Instagram and TikTok.
 */
export async function fetchCaptions(
  bin: string,
  url: string,
  workdir: string,
  lang: string,
  auth: AuthOptions,
): Promise<string | null> {
  await run(bin, [
    ...BASE_ARGS,
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    lang,
    "--sub-format",
    "vtt",
    "--convert-subs",
    "vtt",
    "-o",
    join(workdir, "%(id)s.%(ext)s"),
    ...authArgs(auth),
    url,
  ]);

  return findFile(workdir, (name) => name.endsWith(".vtt"));
}

export type AudioFormat = "wav16" | "mp3";

/**
 * Download the best audio track. whisper.cpp only reads 16 kHz mono, and the
 * hosted APIs charge by upload size, so the caller picks which one it needs.
 */
export async function downloadAudio(
  bin: string,
  url: string,
  workdir: string,
  format: AudioFormat,
  auth: AuthOptions,
): Promise<string> {
  const ext = format === "wav16" ? "wav" : "mp3";
  const formatArgs =
    format === "wav16"
      ? ["--audio-format", "wav", "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1"]
      : ["--audio-format", "mp3", "--audio-quality", "192K"];

  await run(bin, [
    ...BASE_ARGS,
    "-f",
    "bestaudio/best",
    "-x",
    ...formatArgs,
    "-o",
    join(workdir, "%(id)s.%(ext)s"),
    ...authArgs(auth),
    url,
  ]);

  const audio = await findFile(workdir, (name) => name.endsWith(`.${ext}`));
  if (!audio) throw new Error(`yt-dlp reported success but no .${ext} landed in ${workdir}`);
  return audio;
}

export async function cleanup(...paths: (string | null | undefined)[]): Promise<void> {
  await Promise.all(paths.filter((p): p is string => Boolean(p)).map((p) => rm(p, { force: true })));
}
