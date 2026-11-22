#!/usr/bin/env node
/**
 * CLI: ant <url> (or anytranscript <url>) — Instagram, TikTok, YouTube, and
 * anything else yt-dlp reaches.
 */

import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { type BatchEvent, parseUrlList, transcribeMany } from "./batch.js";
import { formatFromPath, OUTPUT_FORMATS, type OutputFormat, renderTranscript } from "./format.js";
import { serveMcp } from "./mcp.js";
import { NoCaptionsError, transcribe } from "./transcribe.js";
import type { ModelSize, WhisperBackend } from "./types.js";

const MODELS: ModelSize[] = ["tiny", "base", "small", "medium", "large-v3"];
const BACKENDS: WhisperBackend[] = ["auto", "local", "openai", "groq"];

const HELP = `
  ant <url> [options]          (anytranscript <url> works too)
  ant <file> [options]         a video or audio file on this computer
  ant <url> <url>... [options]  many videos, one file each
  ant -i urls.txt [options]     URLs from a file, one per line (- for stdin)
  ant mcp                       run as an MCP server, for AI agents (stdio)

  Extract a text transcript from an Instagram, TikTok, or YouTube video URL,
  or from a video or audio file (.mov, .mp4, .m4a, .mp3, .wav...).
  Uses the platform's own captions when they exist; otherwise downloads the
  audio and transcribes it with Whisper.

  Options
    -o, --out <file>          Write the transcript here (default: stdout).
                              The extension picks the format: .md .csv .srt ...
    -f, --format <fmt>        ${OUTPUT_FORMATS.join(", ")} (default: txt)
    -t, --timestamps          txt only: one "[mm:ss] text" line per segment
        --json <file>         Also write timestamped segments as JSON
        --lang <code>         Caption/transcription language (default: en)
        --model <size>        Whisper model: ${MODELS.join(", ")} (default: small)
        --backend <name>      Whisper engine: ${BACKENDS.join(", ")} (default: auto)
        --whisper-only        Skip the caption lookup, always transcribe audio
        --captions-only       Never fall back to Whisper; fail without captions
        --keep-media          Keep the downloaded audio/caption file
        --workdir <dir>       Where to put downloaded media (default: temp dir)
        --cookies-from-browser <name>
                              Pull cookies from chrome, safari, firefox, edge...
                              Instagram login-walls most reels without this.
        --cookies <file>      Netscape-format cookies.txt, as an alternative
    -q, --quiet               Suppress progress output on stderr
    -h, --help                Show this message
    -v, --version             Show the version

  Many videos
    -i, --input <file>        Read URLs from a file, one per line; - for stdin
    -d, --out-dir <dir>       Folder for the transcripts (default: transcripts)
    -j, --jobs <n>            Videos at once (default: 3). Local Whisper still
                              runs one at a time; downloads overlap with it
        --retries <n>         Retries for rate limits, 5xx, timeouts (default: 3)
        --delay <seconds>     Gap between requests to one site (default: 2)
        --timeout <minutes>   Give up on a stuck download step (default: 20)
        --force               Redo videos already finished in an earlier run

    Each video is saved as it finishes, with index.csv (one row per URL) and
    failed.txt (URLs to re-run). Run the same command again to resume: done
    videos are skipped. Ctrl-C stops cleanly.


  Backends
    auto    whisper.cpp if it's installed, else OPENAI_API_KEY or GROQ_API_KEY
    local   whisper.cpp — nothing leaves the machine  (brew install whisper-cpp)
    openai  api.openai.com                            (needs OPENAI_API_KEY)
    groq    api.groq.com                              (needs GROQ_API_KEY)

  Formats
    txt     plain text, or timestamped lines with -t
    md      Markdown notes: title, source, timestamped paragraphs
    csv     start, end, timestamp, text — one row per segment
    json    the full result: text, segments, source, video info
    xlsx    Excel workbook (opens in Google Sheets too): one row per segment
    srt     SubRip subtitles
    vtt     WebVTT subtitles

  Examples
    ant "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ant "https://www.tiktok.com/@user/video/123" -o out.txt
    ant "<url>" -t                          # timestamped lines on stdout
    ant ~/Downloads/IMG_2509.MOV -o notes.md # a video on this computer
    ant "<url>" -o notes.md                 # Markdown, picked from the extension
    ant "<url>" -f csv > segments.csv
    ant "<reel-url>" --cookies-from-browser chrome --model medium
    ant -i urls.txt -f md -d notes           # bulk: one Markdown file per video
    ant -i notes/failed.txt -f md -d notes   # re-run only the failures
`;

async function version(): Promise<string> {
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

/** A non-negative number flag, or the fallback when it wasn't given. */
function amount(value: string | undefined, flag: string, fallback: number, { integer = false, min = 0 } = {}): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    throw new Error(`invalid --${flag} "${value}". Expected ${integer ? "a whole number" : "a number"} of at least ${min}`);
  }
  return n;
}

async function readStdin(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function oneOf<T extends string>(value: string | undefined, allowed: T[], flag: string, fallback: T): T {
  if (value === undefined) return fallback;
  if (!allowed.includes(value as T)) {
    throw new Error(`invalid --${flag} "${value}". Expected one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv[0] === "mcp") {
    await serveMcp();
    return 0;
  }

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      format: { type: "string", short: "f" },
      timestamps: { type: "boolean", short: "t" },
      json: { type: "string" },
      lang: { type: "string" },
      model: { type: "string" },
      backend: { type: "string" },
      "whisper-only": { type: "boolean" },
      "captions-only": { type: "boolean" },
      "keep-media": { type: "boolean" },
      workdir: { type: "string" },
      "cookies-from-browser": { type: "string" },
      cookies: { type: "string" },
      quiet: { type: "boolean", short: "q" },
      input: { type: "string", short: "i" },
      "out-dir": { type: "string", short: "d" },
      jobs: { type: "string", short: "j" },
      retries: { type: "string" },
      delay: { type: "string" },
      timeout: { type: "string" },
      force: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${await version()}\n`);
    return 0;
  }

  const urls = [...positionals];
  if (values.input) {
    const text = values.input === "-" ? await readStdin() : await readFile(values.input, "utf8");
    urls.push(...parseUrlList(text));
  }
  if (urls.length === 0) {
    if (values.input) throw new Error(`no URLs found in ${values.input === "-" ? "stdin" : values.input}`);
    process.stderr.write(`${HELP}\n`);
    return 1;
  }

  const format: OutputFormat = values.format
    ? oneOf(values.format, [...OUTPUT_FORMATS], "format", "txt")
    : (values.out && formatFromPath(values.out)) || "txt";
  const single = urls.length === 1 && !values.input;
  if (single && format === "xlsx" && !values.out && process.stdout.isTTY) {
    throw new Error("xlsx is a binary file, so it can't go to the terminal. Write it with -o transcript.xlsx");
  }

  const log = (message: string) => {
    if (!values.quiet) process.stderr.write(`[anytranscript] ${message}\n`);
  };

  const shared = {
    lang: values.lang ?? "en",
    model: oneOf(values.model, MODELS, "model", "small"),
    backend: oneOf(values.backend, BACKENDS, "backend", "auto"),
    whisperOnly: values["whisper-only"] ?? false,
    captionsOnly: values["captions-only"] ?? false,
    keepMedia: values["keep-media"] ?? false,
    ...(values.workdir ? { workdir: values.workdir } : {}),
    ...(values["cookies-from-browser"] ? { cookiesFromBrowser: values["cookies-from-browser"] } : {}),
    ...(values.cookies ? { cookiesFile: values.cookies } : {}),
  };

  if (urls.length > 1 || values.input) {
    if (values.out) throw new Error("-o writes a single file. For many URLs, pick a folder with -d <dir>.");
    if (values.json) throw new Error("--json writes a single file. For many URLs, use -f json.");
    return runBatch(urls, format, shared, values, log);
  }

  const result = await transcribe(urls[0]!, { ...shared, onProgress: log });

  const rendered = renderTranscript(result, format, { timestamps: values.timestamps ?? false });
  if (values.out) {
    await writeFile(values.out, rendered, "utf8");
    log(`wrote ${format} transcript to ${resolve(values.out)}`);
  } else {
    process.stdout.write(rendered);
  }

  if (values.json) {
    await writeFile(values.json, `${JSON.stringify(result.segments, null, 2)}\n`, "utf8");
    log(`wrote ${result.segments.length} timestamped segments to ${resolve(values.json)}`);
  }

  return 0;
}

type Values = Record<string, string | boolean | undefined>;

async function runBatch(
  urls: string[],
  format: OutputFormat,
  shared: Parameters<typeof transcribe>[1],
  values: Values,
  log: (message: string) => void,
): Promise<number> {
  const outDir = (values["out-dir"] as string | undefined) ?? "transcripts";
  const concurrency = amount(values.jobs as string | undefined, "jobs", 3, { integer: true, min: 1 });
  const retries = amount(values.retries as string | undefined, "retries", 3, { integer: true });
  const delaySeconds = amount(values.delay as string | undefined, "delay", 2);
  const timeoutMinutes = amount(values.timeout as string | undefined, "timeout", 20);

  // First Ctrl-C: stop starting videos and cancel the ones running; what has
  // finished is already on disk. Second Ctrl-C: leave immediately.
  const controller = new AbortController();
  const onInterrupt = () => {
    log("stopping — finished videos are saved. Run the same command again to resume. Ctrl-C again to quit now.");
    controller.abort(new Error("interrupted"));
    process.once("SIGINT", () => process.exit(130));
  };
  process.once("SIGINT", onInterrupt);

  const shown = (path: string) => resolve(path);
  const tag = (e: { position: number; total: number }) => `[${e.position}/${e.total}]`;
  const onEvent = (event: BatchEvent) => {
    switch (event.type) {
      case "plan":
        log(
          `${event.total} video${event.total === 1 ? "" : "s"}: ${event.todo} to do` +
            (event.skipped ? `, ${event.skipped} already done in ${outDir} (--force redoes them)` : "") +
            `, ${Math.min(concurrency, Math.max(event.todo, 1))} at a time.`,
        );
        break;
      case "start":
        if (event.attempt === 1) log(`${tag(event)} ${event.url}`);
        break;
      case "retry":
        log(
          `${tag(event)} retrying in ${Math.ceil(event.delayMs / 1000)}s ` +
            `(attempt ${event.attempt + 1} of ${retries + 1}): ${event.error.message.split("\n")[0]}`,
        );
        break;
      case "done": {
        const { item } = event;
        if (item.status === "ok") log(`${tag(event)} ok: ${item.title} -> ${shown(item.file!)} (${item.source})`);
        if (item.status === "failed") log(`${tag(event)} failed: ${item.error}`);
        break;
      }
    }
  };

  try {
    const result = await transcribeMany(urls, {
      ...shared,
      outDir,
      format,
      formatOptions: { timestamps: Boolean(values.timestamps) },
      concurrency,
      retries,
      delaySeconds,
      timeoutMinutes,
      force: Boolean(values.force),
      signal: controller.signal,
      onEvent,
    });

    const count = (status: string) => result.items.filter((item) => item.status === status).length;
    const [ok, skipped, failed, interrupted] = ["ok", "skipped", "failed", "interrupted"].map(count);
    log(
      [`${ok} done`, skipped && `${skipped} already done`, failed && `${failed} failed`, interrupted && `${interrupted} not finished`]
        .filter(Boolean)
        .join(", ") + `. Summary: ${shown(result.indexFile)}`,
    );
    if (result.failedFile) {
      const formatFlag = format === "txt" ? "" : ` -f ${format}`;
      log(`re-run what's left with: ant -i ${shown(result.failedFile)} -d ${outDir}${formatFlag}`);
    }

    // stdout lists every transcript this run produced or found, so a script
    // can pipe it straight into the next step.
    for (const item of result.items) if (item.file) process.stdout.write(`${resolve(item.file)}\n`);

    if (controller.signal.aborted) return 130;
    return failed || interrupted ? 1 : 0;
  } finally {
    process.removeListener("SIGINT", onInterrupt);
  }
}

/**
 * npm installs `bin` entries as symlinks, so argv[1] is the symlink while
 * import.meta.url is the real file — compare resolved paths or the CLI
 * silently does nothing when run by name.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[anytranscript] ${message}\n`);
      process.exit(error instanceof NoCaptionsError ? 2 : 1);
    },
  );
}
