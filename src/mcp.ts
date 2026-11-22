/**
 * `ant mcp`: the same transcriber as a Model Context Protocol server, so an
 * agent can call it as a tool and get back the text, the timestamps and the
 * full path of any file it saved, instead of shelling out and parsing.
 *
 * MCP over stdio is newline-delimited JSON-RPC 2.0. The handful of methods a
 * tools-only server needs are implemented here directly, which keeps the
 * package at zero runtime dependencies. stdout carries protocol messages
 * only; anything human-readable goes to stderr.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { transcribeMany, transcriptName } from "./batch.js";
import { formatFromPath, formatTranscript, OUTPUT_FORMATS, type OutputFormat, renderTranscript } from "./format.js";
import { NoCaptionsError, transcribe } from "./transcribe.js";
import type { ModelSize, TranscribeOptions, WhisperBackend } from "./types.js";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MODELS: ModelSize[] = ["tiny", "base", "small", "medium", "large-v3"];
const BACKENDS: WhisperBackend[] = ["auto", "local", "openai", "groq"];

const INSTRUCTIONS =
  "Use `transcribe` for one video URL (YouTube, TikTok, Instagram, and most video sites) or one video or audio " +
  "file on this computer (pass its full path as `url`), instead of a web " +
  "search: it returns the transcript with [mm:ss] timestamps plus the video's title and channel, and saves a " +
  "Markdown document in transcripts/ in the user's working folder (or md, csv, xlsx, srt, vtt, json, txt). " +
  "Start your reply with the returned `link` so the user can open the document. Use `transcribe_many` for a " +
  "list of URLs: it saves one file per video into a folder and returns every file path plus an index.csv " +
  "summary. Re-running transcribe_many with the same folder skips videos already done. Don't pass a folder " +
  "unless the user names one, and never use a temporary folder. Quote timestamps when citing what someone " +
  "said. If Instagram fails with a login error, retry with cookiesFromBrowser set to the user's browser.";

/** Options shared by both tools, as JSON Schema. */
const SHARED = {
  lang: { type: "string", description: "Caption/transcription language code. Default en." },
  model: { type: "string", enum: MODELS, description: "Whisper model when there are no captions. Default small." },
  backend: {
    type: "string",
    enum: BACKENDS,
    description: "Speech-to-text engine: local whisper.cpp, or openai/groq with an API key. Default auto.",
  },
  whisperOnly: { type: "boolean", description: "Skip platform captions and always transcribe the audio." },
  captionsOnly: { type: "boolean", description: "Fail instead of transcribing audio when there are no captions." },
  cookiesFromBrowser: {
    type: "string",
    description: "Browser to borrow a login from (chrome, safari, firefox, edge). Needed for most Instagram reels.",
  },
  timestamps: {
    type: "boolean",
    description: "transcribe: [mm:ss] per line in the returned text (default true). Both: timestamped lines in txt files.",
  },
} as const;

const TOOLS = [
  {
    name: "transcribe",
    title: "Transcribe a video",
    description:
      "Get the transcript of one video URL, or of a video or audio file on this computer, with timestamps, title " +
      "and channel. Uses the platform's captions when they exist, otherwise transcribes the audio with Whisper. Use it instead of a web search for what a video says. " +
      "By default it also saves a Markdown document in transcripts/ in the user's working folder and returns its full path " +
      "and a ready-made Markdown link to show the user.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The video URL, or the full path to a video or audio file on this computer (.mov, .mp4, .m4a, .mp3...).",
        },
        format: {
          type: "string",
          enum: OUTPUT_FORMATS,
          description: "Format of the saved file. Default md (a Markdown document). xlsx opens in Excel and Google Sheets.",
        },
        saveAs: { type: "string", description: "Save to this exact path instead; the extension picks the format." },
        outDir: { type: "string", description: "Folder for saved files when format is set. Leave unset to use transcripts/ in the user's working folder. Never a temp folder." },
        save: {
          type: "boolean",
          description: "Save the transcript as a file (default true). Set false only when the user doesn't want a file.",
        },
        includeTranscript: {
          type: "boolean",
          description: "Return the transcript text in the result (default true). Set false when only the file is needed.",
        },
        ...SHARED,
      },
      required: ["url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "transcribe_many",
    title: "Transcribe a list of videos",
    description:
      "Transcribe many video URLs or local video/audio files into a folder, one file per video, with retries, a limit on parallel downloads, " +
      "and resume: videos already done in that folder are skipped. Returns each file's full path, an index.csv " +
      "summary and a failed.txt list to retry. Can take minutes; progress is reported per video.",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, minItems: 1, description: "Video URLs or full paths to local video/audio files." },
        outDir: { type: "string", description: "Folder for the files. Leave unset to use transcripts/ in the user's working folder. Never a temp folder." },
        format: { type: "string", enum: OUTPUT_FORMATS, description: "File format for each video. Default md." },
        concurrency: { type: "integer", minimum: 1, description: "Videos at once. Default 3." },
        retries: { type: "integer", minimum: 0, description: "Retries for temporary failures. Default 3." },
        delaySeconds: { type: "number", minimum: 0, description: "Gap between requests to one site. Default 2." },
        force: { type: "boolean", description: "Redo videos already finished in this folder." },
        ...SHARED,
      },
      required: ["urls"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
] as const;

type Args = Record<string, unknown>;

class ArgumentError extends Error {}

function str(args: Args, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new ArgumentError(`${key} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new ArgumentError(`${key} must be a string`);
  return value;
}

function bool(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ArgumentError(`${key} must be true or false`);
  return value;
}

function num(args: Args, key: string, { integer = false, min = 0 } = {}): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) {
    throw new ArgumentError(`${key} must be ${integer ? "a whole number" : "a number"} of at least ${min}`);
  }
  return value;
}

function choice<T extends string>(args: Args, key: string, allowed: readonly T[]): T | undefined {
  const value = str(args, key);
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) throw new ArgumentError(`${key} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

function sharedOptions(args: Args): TranscribeOptions {
  const options: TranscribeOptions = {};
  const lang = str(args, "lang");
  const model = choice(args, "model", MODELS);
  const backend = choice(args, "backend", BACKENDS);
  const whisperOnly = bool(args, "whisperOnly");
  const captionsOnly = bool(args, "captionsOnly");
  const cookiesFromBrowser = str(args, "cookiesFromBrowser");
  if (lang) options.lang = lang;
  if (model) options.model = model;
  if (backend) options.backend = backend;
  if (whisperOnly !== undefined) options.whisperOnly = whisperOnly;
  if (captionsOnly !== undefined) options.captionsOnly = captionsOnly;
  if (cookiesFromBrowser) options.cookiesFromBrowser = cookiesFromBrowser;
  return options;
}

const log = (message: string) => process.stderr.write(`[anytranscript] ${message}\n`);

interface CallContext {
  signal: AbortSignal;
  progress: (done: number, total: number, message: string) => void;
}

/** `[title](/full/path.md)`, which Claude and Codex open with a click. */
export function markdownLink(title: string, path: string): string {
  const text = title.replace(/[\[\]\\]/g, "\\$&").replace(/\s+/g, " ").trim() || "transcript";
  const target = /[\s()<>]/.test(path) ? `<${path.replace(/[<>]/g, encodeURIComponent)}>` : path;
  return `[${text}](${target})`;
}

async function callTranscribe(args: Args, { signal }: CallContext): Promise<unknown> {
  const url = str(args, "url", true)!;
  const saveAs = str(args, "saveAs");
  const save = saveAs !== undefined || (bool(args, "save") ?? true);
  const format = saveAs
    ? (choice(args, "format", OUTPUT_FORMATS) ?? formatFromPath(saveAs) ?? "txt")
    : (choice(args, "format", OUTPUT_FORMATS) ?? "md");
  const outDir = str(args, "outDir") ?? "transcripts";
  const timestamps = bool(args, "timestamps") ?? true;
  const includeTranscript = bool(args, "includeTranscript") ?? true;

  const transcript = await transcribe(url, { ...sharedOptions(args), signal, onProgress: log });

  let file: string | null = null;
  if (save) {
    file = resolve(saveAs ?? join(outDir, `${transcriptName(transcript, url)}.${format}`));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, renderTranscript(transcript, format as OutputFormat, { timestamps }));
  }

  const { info } = transcript;
  return {
    title: info.title,
    url: info.webpageUrl,
    channel: info.uploader,
    duration: info.duration,
    source: transcript.source,
    language: transcript.language,
    file,
    link: file ? markdownLink(info.title, file) : null,
    ...(includeTranscript
      ? { transcript: formatTranscript(transcript, "txt", { timestamps }).trimEnd() }
      : {}),
  };
}

async function callTranscribeMany(args: Args, { signal, progress }: CallContext): Promise<unknown> {
  const urls = args.urls;
  if (!Array.isArray(urls) || urls.length === 0 || !urls.every((u) => typeof u === "string")) {
    throw new ArgumentError("urls must be a non-empty list of URL strings");
  }
  const outDir = resolve(str(args, "outDir") ?? "transcripts");
  const format = choice(args, "format", OUTPUT_FORMATS) ?? "md";
  const concurrency = num(args, "concurrency", { integer: true, min: 1 });
  const retries = num(args, "retries", { integer: true });
  const delaySeconds = num(args, "delaySeconds");
  const force = bool(args, "force");
  const timestamps = bool(args, "timestamps");

  let settled = 0;
  const result = await transcribeMany(urls as string[], {
    ...sharedOptions(args),
    outDir,
    format,
    formatOptions: { timestamps: timestamps ?? false },
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(retries !== undefined ? { retries } : {}),
    ...(delaySeconds !== undefined ? { delaySeconds } : {}),
    ...(force !== undefined ? { force } : {}),
    signal,
    onEvent: (event) => {
      if (event.type === "plan") settled = event.skipped;
      if (event.type === "done" && event.item.status !== "skipped") {
        settled += 1;
        const { item } = event;
        progress(settled, event.total, `${item.status}: ${item.title ?? item.url}`);
      }
    },
  });

  const count = (status: string) => result.items.filter((item) => item.status === status).length;
  const indexXlsx = join(outDir, "index.xlsx");
  return {
    outDir,
    index: result.indexFile,
    ...(format === "xlsx" ? { indexXlsx } : {}),
    failedList: result.failedFile ?? null,
    done: count("ok"),
    alreadyDone: count("skipped"),
    failed: count("failed"),
    notFinished: count("interrupted"),
    items: result.items.map((item) => ({
      url: item.url,
      status: item.status,
      title: item.title ?? null,
      file: item.file ? resolve(item.file) : null,
      link: item.file ? markdownLink(item.title ?? basename(item.file), resolve(item.file)) : null,
      ...(item.error ? { error: item.error } : {}),
    })),
  };
}

const HANDLERS: Record<string, (args: Args, context: CallContext) => Promise<unknown>> = {
  transcribe: callTranscribe,
  transcribe_many: callTranscribeMany,
};

function hint(error: Error): string {
  if (error instanceof NoCaptionsError) return " Retry without captionsOnly to transcribe the audio instead.";
  if (/login required|Sign in|cookies/i.test(error.message)) {
    return " Retry with cookiesFromBrowser set to the browser the user is logged in with.";
  }
  return "";
}

async function version(): Promise<string> {
  const pkg = JSON.parse(await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  return (pkg as { version: string }).version;
}

interface Message {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Args & { _meta?: { progressToken?: string | number } };
}

/** Serve MCP on stdin/stdout until stdin closes. */
export async function serveMcp(): Promise<void> {
  const serverVersion = await version();
  const running = new Map<string | number, AbortController>();
  const send = (message: object): void => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };
  const reply = (id: Message["id"], result: object) => send({ id, result });
  const fail = (id: Message["id"], code: number, message: string) => send({ id, error: { code, message } });
  const pending = new Set<Promise<void>>();

  async function handle(message: Message): Promise<void> {
    const { id, method, params = {} } = message;
    const isRequest = id !== undefined && id !== null;

    switch (method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        return reply(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "anytranscript", title: "anytranscript", version: serverVersion },
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return reply(id, {});
      case "tools/list":
        return reply(id, { tools: TOOLS });
      case "notifications/cancelled": {
        const target = params.requestId as string | number | undefined;
        if (target !== undefined) running.get(target)?.abort(new Error("cancelled by the client"));
        return;
      }
      case "tools/call": {
        const name = params.name as string;
        const handler = HANDLERS[name];
        if (!handler) return fail(id, -32602, `unknown tool: ${name}`);
        const controller = new AbortController();
        if (isRequest) running.set(id, controller);
        const token = params._meta?.progressToken;
        const progress = (done: number, total: number, text: string) => {
          if (token !== undefined) {
            send({ method: "notifications/progress", params: { progressToken: token, progress: done, total, message: text } });
          }
        };
        try {
          const result = await handler((params.arguments ?? {}) as Args, { signal: controller.signal, progress });
          return reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
        } catch (thrown) {
          const error = thrown instanceof Error ? thrown : new Error(String(thrown));
          const text = error instanceof ArgumentError ? `Invalid arguments: ${error.message}` : `${error.message}${hint(error)}`;
          return reply(id, { content: [{ type: "text", text }], isError: true });
        } finally {
          if (isRequest) running.delete(id);
        }
      }
      default:
        if (isRequest) return fail(id, -32601, `method not found: ${method}`);
    }
  }

  log(`MCP server ${serverVersion} ready on stdio`);
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      send({ id: null, error: { code: -32700, message: "parse error" } });
      continue;
    }
    // Requests run concurrently: a long transcribe_many must not block a ping.
    const work = handle(message).catch((error: unknown) => {
      if (message.id !== undefined) fail(message.id, -32603, error instanceof Error ? error.message : String(error));
    });
    pending.add(work);
    void work.finally(() => pending.delete(work));
  }
  for (const controller of running.values()) controller.abort(new Error("client disconnected"));
  await Promise.allSettled(pending);
}
