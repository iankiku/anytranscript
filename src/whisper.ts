/**
 * Speech-to-text, used whenever the platform doesn't hand us captions — which
 * is the normal case for Instagram and TikTok.
 *
 * Two kinds of backend: whisper.cpp running locally (nothing leaves the
 * machine, no per-minute cost), or a hosted OpenAI-compatible endpoint for
 * machines that have no local build.
 */

import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheDir, ensureDownloaded, huggingFaceSha256 } from "./cache.js";
import { isRunnable, run } from "./proc.js";
import type { ModelSize, Segment, WhisperBackend } from "./types.js";

const MODEL_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const LOCAL_BINARIES = ["whisper-cli", "whisper-cpp", "whisper"];

const HOSTED = {
  openai: {
    url: "https://api.openai.com/v1/audio/transcriptions",
    model: "whisper-1",
    envVar: "OPENAI_API_KEY",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/audio/transcriptions",
    model: "whisper-large-v3-turbo",
    envVar: "GROQ_API_KEY",
  },
} as const;

export type HostedProvider = keyof typeof HOSTED;

export interface WhisperResult {
  text: string;
  language: string;
  segments: Segment[];
}

export interface WhisperOptions {
  model: ModelSize;
  lang: string;
  binary?: string;
  onProgress?: (message: string) => void;
}

/** The whisper.cpp binary on PATH, or null if there isn't one. */
export async function resolveLocalWhisper(explicit?: string): Promise<string | null> {
  const candidate = explicit || process.env.ANYTRANSCRIPT_WHISPER;
  if (candidate) return candidate;

  for (const bin of LOCAL_BINARIES) {
    if (await isRunnable(bin)) return bin;
  }
  return null;
}

function hostedWithKey(): HostedProvider | null {
  for (const provider of Object.keys(HOSTED) as HostedProvider[]) {
    if (process.env[HOSTED[provider].envVar]) return provider;
  }
  return null;
}

/**
 * Turn `auto` into a concrete backend: local whisper.cpp if it's installed,
 * otherwise whichever hosted provider has a key in the environment.
 */
export async function selectBackend(
  requested: WhisperBackend,
  binary?: string,
): Promise<Exclude<WhisperBackend, "auto">> {
  if (requested !== "auto") return requested;

  if (await resolveLocalWhisper(binary)) return "local";

  const hosted = hostedWithKey();
  if (hosted) return hosted;

  throw new Error(
    "no speech-to-text backend available. Install whisper.cpp (`brew install whisper-cpp`) " +
      "for local transcription, or set OPENAI_API_KEY or GROQ_API_KEY to use a hosted one.",
  );
}

/** Fetch the ggml weights for a model size, caching them across runs. */
export async function ensureModel(
  size: ModelSize,
  onProgress?: (message: string) => void,
): Promise<string> {
  const file = `ggml-${size}.bin`;
  const url = `${MODEL_BASE}/${file}`;
  const sha256 = await huggingFaceSha256(url);

  return ensureDownloaded(url, cacheDir("models", file), {
    ...(sha256 ? { sha256 } : {}),
    onProgress,
    label: `Whisper model "${size}" (first run only)`,
  });
}

interface WhisperCppJson {
  result?: { language?: string };
  transcription?: { offsets?: { from: number; to: number }; text?: string }[];
}

/** Transcribe a 16 kHz mono WAV with a local whisper.cpp build. */
export async function transcribeLocal(
  wavPath: string,
  { model, lang, binary, onProgress }: WhisperOptions,
): Promise<WhisperResult> {
  const bin = await resolveLocalWhisper(binary);
  if (!bin) throw new Error("whisper.cpp not found — install it with `brew install whisper-cpp`.");

  const modelPath = await ensureModel(model, onProgress);
  const outBase = join(tmpdir(), `anytranscript-${process.pid}-${Date.now()}`);

  try {
    await run(bin, [
      "-m", modelPath,
      "-f", wavPath,
      "-l", lang,
      "-oj",
      "-of", outBase,
      "-np",
    ]);

    const parsed = JSON.parse(await readFile(`${outBase}.json`, "utf8")) as WhisperCppJson;
    const segments: Segment[] = (parsed.transcription ?? [])
      .map((cue) => ({
        start: (cue.offsets?.from ?? 0) / 1000,
        end: (cue.offsets?.to ?? 0) / 1000,
        text: (cue.text ?? "").trim(),
      }))
      .filter((segment) => segment.text.length > 0);

    return {
      text: segments.map((segment) => segment.text).join(" ").trim(),
      language: parsed.result?.language || lang,
      segments,
    };
  } finally {
    await rm(`${outBase}.json`, { force: true });
  }
}

interface VerboseJson {
  text?: string;
  language?: string;
  segments?: { start: number; end: number; text: string }[];
}

/** Transcribe via an OpenAI-compatible hosted endpoint. */
export async function transcribeHosted(
  audioPath: string,
  provider: HostedProvider,
  { lang }: Pick<WhisperOptions, "lang">,
): Promise<WhisperResult> {
  const { url, model, envVar } = HOSTED[provider];
  const key = process.env[envVar];
  if (!key) throw new Error(`${envVar} is not set, so the "${provider}" backend can't be used.`);

  const form = new FormData();
  form.append("file", new Blob([await readFile(audioPath)]), "audio.mp3");
  form.append("model", model);
  form.append("response_format", "verbose_json");
  if (lang) form.append("language", lang);

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`${provider} transcription failed: HTTP ${response.status} ${await response.text()}`);
  }

  const parsed = (await response.json()) as VerboseJson;
  const segments: Segment[] = (parsed.segments ?? []).map((segment) => ({
    start: segment.start,
    end: segment.end,
    text: segment.text.trim(),
  }));

  return {
    text: (parsed.text ?? segments.map((s) => s.text).join(" ")).trim(),
    language: parsed.language || lang,
    segments,
  };
}
