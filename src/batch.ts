/**
 * Bulk transcription: many URLs in, one file per video plus a summary out.
 *
 * Built to survive long unattended runs. Each finished video is written to
 * disk and recorded in `manifest.jsonl` straight away, so a crash, a Ctrl-C
 * or a dead laptop battery loses at most the videos that were mid-flight,
 * and running the same command again picks up where it stopped.
 */

import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { exists } from "./cache.js";
import { csvRow, type FormatOptions, type OutputFormat, renderTranscript } from "./format.js";
import { runTasks } from "./scheduler.js";
import { buildWorkbook } from "./xlsx.js";
import { isRateLimited, isRetryable, siteKey } from "./retry.js";
import { transcribe } from "./transcribe.js";
import type { Transcript, TranscribeOptions } from "./types.js";
import { summarizeCommandError } from "./ytdlp.js";

export interface BatchOptions extends Omit<TranscribeOptions, "onProgress" | "signal" | "timeoutMs"> {
  /** Folder for the transcripts, `index.csv`, `manifest.jsonl` and `failed.txt`. */
  outDir: string;
  /** File format for each transcript. Default `txt`. */
  format?: OutputFormat;
  formatOptions?: FormatOptions;
  /** Videos processed at once. Local Whisper still runs one at a time. Default 3. */
  concurrency?: number;
  /** Extra attempts for temporary failures (rate limits, 5xx, network). Default 3. */
  retries?: number;
  /** Minimum seconds between two requests to the same site. Default 2. */
  delaySeconds?: number;
  /** Give up on a single network step after this many minutes. Default 20. */
  timeoutMinutes?: number;
  /** Redo videos that already finished in an earlier run. */
  force?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: BatchEvent) => void;
  /** Replace the transcriber, e.g. in tests. Defaults to `transcribe`. */
  transcriber?: (url: string, options: TranscribeOptions) => Promise<Transcript>;
  /** Base delay before the first retry, in ms. Default 5000. */
  retryDelayMs?: number;
}

export type BatchStatus = "ok" | "skipped" | "failed" | "interrupted";

export interface BatchItem {
  url: string;
  status: BatchStatus;
  /** Path of the transcript file, for `ok` and `skipped`. */
  file?: string;
  title?: string;
  uploader?: string | null;
  duration?: number | null;
  source?: string;
  language?: string;
  attempts: number;
  error?: string;
}

export type BatchEvent =
  | { type: "plan"; total: number; todo: number; skipped: number }
  | { type: "start"; position: number; total: number; url: string; attempt: number }
  | { type: "retry"; position: number; total: number; url: string; attempt: number; delayMs: number; error: Error }
  | { type: "done"; position: number; total: number; item: BatchItem };

export interface BatchResult {
  /** One item per URL given to this run, in input order. */
  items: BatchItem[];
  /** One row per URL ever run into this folder, this run's results on top. */
  indexFile: string;
  /** URLs that failed or were interrupted, one per line; absent when there were none. */
  failedFile?: string;
}

interface ManifestRecord extends Omit<BatchItem, "file"> {
  file?: string;
  format?: OutputFormat;
  /** The format options the file was written with; see `variant`. */
  variant?: string;
  at: string;
}

/** Same format but different options (say, -t) is a different file. */
function variant({ timestamps = false, paragraphSeconds }: FormatOptions): string {
  return JSON.stringify({ timestamps, paragraphSeconds: paragraphSeconds ?? null });
}

/**
 * URLs from a text file: one per line, blank lines and `#` comments ignored.
 * Anything after the first whitespace on a line is ignored too, so a note can
 * follow the URL.
 */
export function parseUrlList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/)[0]!);
}

/** A short, filesystem-safe name: `me-at-the-zoo-jNQXAC9IVRw`. */
export function transcriptName(transcript: Transcript, url: string): string {
  const slug = transcript.info.title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  const rawId = transcript.info.id.replace(/[^A-Za-z0-9_-]/g, "");
  const id =
    rawId && rawId !== "unknown" ? rawId : createHash("sha256").update(url).digest("hex").slice(0, 10);
  return slug ? `${slug}-${id}` : id;
}

/** The latest record per URL, in the order URLs were first seen. */
async function readManifest(path: string): Promise<Map<string, ManifestRecord>> {
  const latest = new Map<string, ManifestRecord>();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return latest;
  }
  // A crash mid-append leaves a last line with no newline. Close it off now,
  // or this run's first record would be glued onto it and lost with it.
  if (text && !text.endsWith("\n")) await appendFile(path, "\n", "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as ManifestRecord;
      if (record.url) latest.set(record.url, record);
    } catch {
      // A line cut short by a crash mid-write; the run before it is still good.
    }
  }
  return latest;
}

function recordToItem(record: ManifestRecord, outDir: string): BatchItem {
  const { at: _at, format: _format, variant: _variant, file, ...rest } = record;
  return { ...rest, ...(file ? { file: join(outDir, file) } : {}) };
}

/**
 * Write via a temp file and rename, so a crash never leaves half a transcript.
 * The temp name is unique because the same video can arrive under two URLs
 * (youtu.be and youtube.com) and be written twice at once.
 */
async function writeAtomic(path: string, contents: string | Uint8Array): Promise<void> {
  const partial = `${path}.${randomUUID().slice(0, 8)}.part`;
  await writeFile(partial, contents);
  await rename(partial, path);
}

const INDEX_HEADER = ["url", "status", "title", "uploader", "duration", "source", "language", "file", "attempts", "error"];

/**
 * Transcribe many URLs into `outDir`, one file each, with retries, per-site
 * spacing and resume. Never throws for a single bad URL: every URL comes back
 * as an item with a status.
 */
export async function transcribeMany(urls: string[], options: BatchOptions): Promise<BatchResult> {
  const {
    outDir,
    format = "txt",
    formatOptions = {},
    concurrency = 3,
    retries = 3,
    delaySeconds = 2,
    timeoutMinutes = 20,
    force = false,
    signal,
    onEvent = () => {},
    transcriber = transcribe,
    retryDelayMs = 5_000,
    workdir,
    ...transcribeOptions
  } = options;

  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  const total = unique.length;
  await mkdir(outDir, { recursive: true });

  const manifestFile = join(outDir, "manifest.jsonl");
  const previous = await readManifest(manifestFile);
  const wanted = variant(formatOptions);
  const items: BatchItem[] = new Array(total);
  const todo: number[] = [];

  for (const [i, url] of unique.entries()) {
    const record = force ? undefined : previous.get(url);
    const done =
      record?.status === "ok" &&
      record.format === format &&
      (record.variant ?? variant({})) === wanted &&
      record.file !== undefined &&
      (await exists(join(outDir, record.file)));
    if (done) {
      items[i] = { ...recordToItem(record!, outDir), status: "skipped" };
    } else {
      todo.push(i);
    }
  }
  onEvent({ type: "plan", total, todo: todo.length, skipped: total - todo.length });

  const attempts: number[] = new Array(total).fill(0);
  const writes: Promise<void>[] = [];

  // Recorded the moment each video settles, not at the end: this line is
  // what lets a re-run after a crash skip the work that already finished.
  const settle = async (i: number, item: BatchItem) => {
    items[i] = item;
    const line: ManifestRecord = {
      ...item,
      ...(item.file ? { file: basename(item.file) } : {}),
      format,
      variant: wanted,
      at: new Date().toISOString(),
    };
    await appendFile(manifestFile, `${JSON.stringify(line)}\n`, "utf8");
    onEvent({ type: "done", position: i + 1, total, item });
  };

  await runTasks(
    todo.map((i) => {
      const url = unique[i]!;
      return {
        key: siteKey(url),
        run: async (jobSignal: AbortSignal) => {
          attempts[i] = (attempts[i] ?? 0) + 1;
          const transcript = await transcriber(url, {
            ...transcribeOptions,
            ...(workdir ? { workdir: join(workdir, String(i + 1)) } : {}),
            signal: jobSignal,
            ...(timeoutMinutes > 0 ? { timeoutMs: timeoutMinutes * 60_000 } : {}),
          });
          jobSignal.throwIfAborted();
          const file = join(outDir, `${transcriptName(transcript, url)}.${format}`);
          await writeAtomic(file, renderTranscript(transcript, format, formatOptions));
          await settle(i, {
            url,
            status: "ok",
            file,
            title: transcript.info.title,
            uploader: transcript.info.uploader,
            duration: transcript.info.duration,
            source: transcript.source,
            language: transcript.language,
            attempts: attempts[i]!,
          });
        },
      };
    }),
    {
      concurrency,
      retries,
      gapMs: delaySeconds * 1000,
      retryDelayMs,
      isRetryable,
      isRateLimited,
      ...(signal ? { signal } : {}),
      onEvent: (event) => {
        const i = todo[event.index]!;
        const base = { position: i + 1, total, url: unique[i]! };
        if (event.type === "start") onEvent({ type: "start", ...base, attempt: event.attempt });
        if (event.type === "retry") {
          onEvent({ type: "retry", ...base, attempt: event.attempt, delayMs: event.delayMs, error: event.error });
        }
        if (event.type === "failed") {
          const item: BatchItem = { url: base.url, status: "failed", attempts: event.attempts, error: summarizeCommandError(event.error) };
          writes.push(settle(i, item));
        }
      },
    },
  );
  await Promise.all(writes);

  // Whatever is left was queued or mid-flight when the run was stopped. It is
  // not written to the manifest, so the next run picks it up again.
  for (const i of todo) {
    if (!items[i]) {
      items[i] = { url: unique[i]!, status: "interrupted", attempts: attempts[i] ?? 0 };
      onEvent({ type: "done", position: i + 1, total, item: items[i]! });
    }
  }

  // The index covers the whole folder, so re-running only failed.txt doesn't
  // drop the rows for everything that succeeded before.
  const folder = new Map<string, BatchItem>();
  for (const [url, record] of previous) folder.set(url, recordToItem(record, outDir));
  for (const item of items) folder.set(item.url, item);

  const indexFile = join(outDir, "index.csv");
  const indexCells = [...folder.values()].map((item) => [
    item.url,
    item.status,
    item.title,
    item.uploader,
    item.duration,
    item.source,
    item.language,
    item.file ? basename(item.file) : undefined,
    item.attempts,
    item.error,
  ]);
  const rows = indexCells.map(csvRow);
  await writeAtomic(indexFile, `${[INDEX_HEADER.join(","), ...rows].join("\n")}\n`);
  if (format === "xlsx") {
    // Spreadsheet users get the summary as a workbook too.
    await writeAtomic(
      join(outDir, "index.xlsx"),
      buildWorkbook([
        {
          name: "Videos",
          widths: [45, 12, 50, 20, 10, 10, 10, 50, 9, 50],
          rows: [INDEX_HEADER, ...indexCells],
        },
      ]),
    );
  }

  const failedPath = join(outDir, "failed.txt");
  const failed = [...folder.values()].filter((item) => item.status === "failed" || item.status === "interrupted");
  if (failed.length) {
    await writeAtomic(failedPath, `${failed.map((item) => item.url).join("\n")}\n`);
    return { items, indexFile, failedFile: failedPath };
  }
  await rm(failedPath, { force: true });
  return { items, indexFile };
}
