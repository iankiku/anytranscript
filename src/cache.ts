/** On-disk cache for the binaries and model weights we fetch on demand. */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** `~/.cache/anytranscript`, or wherever XDG_CACHE_HOME points. */
export function cacheDir(...parts: string[]): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "anytranscript", ...parts);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class IntegrityError extends Error {
  constructor(label: string, expected: string, actual: string) {
    super(
      `checksum mismatch for ${label}\n  expected ${expected}\n  actual   ${actual}\n` +
        "The download was discarded. This means the file was corrupted in transit or " +
        "the upstream artifact changed — do not work around it by disabling verification.",
    );
    this.name = "IntegrityError";
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

export interface DownloadOptions {
  /** chmod applied once the file is in place — 0o755 for executables. */
  mode?: number;
  /** Expected SHA-256. The download is discarded if it doesn't match. */
  sha256?: string;
  onProgress?: (message: string) => void;
  label?: string;
}

/** Downloads in progress in this process, so parallel jobs share one fetch. */
const inFlight = new Map<string, Promise<string>>();

/**
 * Fetch `url` to `dest` if it isn't cached already.
 *
 * Downloads land on a `.part` file and are verified before being moved into
 * place, so an interrupted or tampered-with download can never leave a
 * truncated binary or model that looks complete on every subsequent run.
 * Concurrent calls for the same `dest` share one download; each process
 * writes its own `.part` file, so two processes can't interleave bytes.
 */
export async function ensureDownloaded(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<string> {
  if (await exists(dest)) return dest;

  let pending = inFlight.get(dest);
  if (!pending) {
    pending = download(url, dest, options).finally(() => inFlight.delete(dest));
    inFlight.set(dest, pending);
  }
  return pending;
}

async function download(
  url: string,
  dest: string,
  { mode, sha256, onProgress, label }: DownloadOptions,
): Promise<string> {
  const name = label ?? url;
  onProgress?.(`downloading ${name}...`);
  await mkdir(join(dest, ".."), { recursive: true });

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`failed to download ${name}: HTTP ${response.status} ${response.statusText}`);
  }

  const partial = `${dest}.${randomUUID().slice(0, 8)}.part`;
  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(partial),
    );

    if (sha256) {
      const actual = await sha256File(partial);
      if (actual !== sha256.toLowerCase()) throw new IntegrityError(name, sha256, actual);
      onProgress?.(`verified ${name} (sha256 ${sha256.slice(0, 12)}...)`);
    }

    // chmod before the rename: once `dest` exists, other runs treat it as ready.
    if (mode !== undefined) await chmod(partial, mode);
    await rename(partial, dest);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }

  return dest;
}

/**
 * The SHA-256 a Hugging Face LFS file advertises, read from `x-linked-etag`.
 *
 * Two traps here, both of which silently yield the wrong digest:
 *   - HF redirects to a CDN, and only HF's own response carries the header,
 *     so the request must NOT follow the redirect.
 *   - The CDN's plain `etag` is also 64 hex characters but is a different
 *     hash entirely, so falling back to it fails every verification.
 */
export async function huggingFaceSha256(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "manual" });
    const digest = response.headers.get("x-linked-etag")?.replace(/^(W\/)?"|"$/g, "");
    return digest && /^[a-f0-9]{64}$/.test(digest) ? digest : undefined;
  } catch {
    // A checksum we couldn't fetch shouldn't break an otherwise fine download.
    return undefined;
  }
}
