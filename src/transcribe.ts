/**
 * The orchestrator: captions first when the platform actually has them (fast
 * and free), audio + Whisper otherwise.
 */

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Transcript, TranscribeOptions } from "./types.js";
import { vttToSegments } from "./vtt.js";
import { cleanup, downloadAudio, fetchCaptions, getInfo, resolveYtDlp } from "./ytdlp.js";
import { selectBackend, transcribeHosted, transcribeLocal } from "./whisper.js";

export class NoCaptionsError extends Error {
  constructor(url: string) {
    super(`no captions available for ${url} and captionsOnly was set`);
    this.name = "NoCaptionsError";
  }
}

/**
 * Pull a transcript out of any URL yt-dlp can reach.
 *
 * @example
 * const { text } = await transcribe("https://www.youtube.com/watch?v=...");
 */
export async function transcribe(url: string, options: TranscribeOptions = {}): Promise<Transcript> {
  const {
    lang = "en",
    model = "small",
    backend = "auto",
    whisperOnly = false,
    captionsOnly = false,
    keepMedia = false,
    workdir: requestedWorkdir,
    ytdlpPath,
    whisperPath,
    onProgress = () => {},
    ...auth
  } = options;

  const workdir = requestedWorkdir ?? (await mkdtemp(join(tmpdir(), "anytranscript-")));
  const ownsWorkdir = !requestedWorkdir;
  const media: string[] = [];

  await mkdir(workdir, { recursive: true });

  try {
    const bin = await resolveYtDlp(ytdlpPath, onProgress);
    const info = await getInfo(bin, url, auth);
    onProgress(`${info.extractor}: "${info.title}"${info.uploader ? ` (${info.uploader})` : ""}`);

    if (!whisperOnly) {
      onProgress("checking for existing captions...");
      const vttPath = await fetchCaptions(bin, url, workdir, lang, auth);

      if (vttPath) {
        media.push(vttPath);
        const segments = vttToSegments(await readFile(vttPath, "utf8"));
        const text = segments.map((segment) => segment.text).join(" ").trim();
        onProgress(`done via captions, ${text.length} chars.`);
        return { text, source: "captions", language: lang, segments, info };
      }

      if (captionsOnly) throw new NoCaptionsError(url);
    }

    const engine = await selectBackend(backend, whisperPath);
    onProgress(`no captions available — downloading audio and transcribing (${engine}, ${model})...`);

    const audioPath = await downloadAudio(bin, url, workdir, engine === "local" ? "wav16" : "mp3", auth);
    media.push(audioPath);

    const result =
      engine === "local"
        ? await transcribeLocal(audioPath, { model, lang, binary: whisperPath, onProgress })
        : await transcribeHosted(audioPath, engine, { lang });

    onProgress(`done via ${engine}, ${result.text.length} chars.`);
    return { ...result, source: "whisper", info };
  } finally {
    if (!keepMedia) {
      if (ownsWorkdir) await rm(workdir, { recursive: true, force: true });
      else await cleanup(...media);
    }
  }
}
