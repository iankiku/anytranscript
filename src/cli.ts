#!/usr/bin/env node
/**
 * CLI: ant <url> (or anytranscript <url>) — Instagram, TikTok, YouTube, and
 * anything else yt-dlp reaches.
 */

import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { formatFromPath, formatTranscript, OUTPUT_FORMATS, type OutputFormat } from "./format.js";
import { NoCaptionsError, transcribe } from "./transcribe.js";
import type { ModelSize, WhisperBackend } from "./types.js";

const MODELS: ModelSize[] = ["tiny", "base", "small", "medium", "large-v3"];
const BACKENDS: WhisperBackend[] = ["auto", "local", "openai", "groq"];

const HELP = `
  ant <url> [options]        (anytranscript <url> works too)

  Extract a text transcript from an Instagram, TikTok, or YouTube video URL.
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
    srt     SubRip subtitles
    vtt     WebVTT subtitles

  Examples
    ant "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ant "https://www.tiktok.com/@user/video/123" -o out.txt
    ant "<url>" -t                          # timestamped lines on stdout
    ant "<url>" -o notes.md                 # Markdown, picked from the extension
    ant "<url>" -f csv > segments.csv
    ant "<reel-url>" --cookies-from-browser chrome --model medium
`;

async function version(): Promise<string> {
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

function oneOf<T extends string>(value: string | undefined, allowed: T[], flag: string, fallback: T): T {
  if (value === undefined) return fallback;
  if (!allowed.includes(value as T)) {
    throw new Error(`invalid --${flag} "${value}". Expected one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
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

  const url = positionals[0];
  if (!url) {
    process.stderr.write(`${HELP}\n`);
    return 1;
  }

  const format: OutputFormat = values.format
    ? oneOf(values.format, [...OUTPUT_FORMATS], "format", "txt")
    : (values.out && formatFromPath(values.out)) || "txt";

  const log = (message: string) => {
    if (!values.quiet) process.stderr.write(`[anytranscript] ${message}\n`);
  };

  const result = await transcribe(url, {
    lang: values.lang ?? "en",
    model: oneOf(values.model, MODELS, "model", "small"),
    backend: oneOf(values.backend, BACKENDS, "backend", "auto"),
    whisperOnly: values["whisper-only"] ?? false,
    captionsOnly: values["captions-only"] ?? false,
    keepMedia: values["keep-media"] ?? false,
    ...(values.workdir ? { workdir: values.workdir } : {}),
    ...(values["cookies-from-browser"] ? { cookiesFromBrowser: values["cookies-from-browser"] } : {}),
    ...(values.cookies ? { cookiesFile: values.cookies } : {}),
    onProgress: log,
  });

  const rendered = formatTranscript(result, format, { timestamps: values.timestamps ?? false });
  if (values.out) {
    await writeFile(values.out, rendered, "utf8");
    log(`wrote ${format} transcript to ${values.out}`);
  } else {
    process.stdout.write(rendered);
  }

  if (values.json) {
    await writeFile(values.json, `${JSON.stringify(result.segments, null, 2)}\n`, "utf8");
    log(`wrote ${result.segments.length} timestamped segments to ${values.json}`);
  }

  return 0;
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
