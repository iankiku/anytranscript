/**
 * The orchestrator: captions first when the platform actually has them (fast
 * and free), audio + Whisper otherwise. A file on this computer goes straight
 * to ffmpeg + Whisper.
 */

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAudio, localInfo, localMediaPath } from "./local.js";
import type { Transcript, TranscribeOptions } from "./types.js";
import { parseVideoUrl } from "./url.js";
import { vttToSegments } from "./vtt.js";
import { cleanup, downloadAudio, fetchCaptions, getInfo, resolveYtDlp } from "./ytdlp.js";
import { selectBackend, transcribeHosted, transcribeLocal } from "./whisper.js";

export class NoCaptionsError extends Error {
  constructor(url: string, reason?: string) {
    const suffix = reason ? ` (${reason})` : "";
    super(
      `no captions available for ${url}${suffix} and --captions-only was set. ` +
        "Omit --captions-only to fall back to Whisper audio transcription.",
    );
    this.name = "NoCaptionsError";
  }
}

/**
 * Pull a transcript out of any URL yt-dlp can reach, or out of a video or
 * audio file on this computer.
 *
 * @example
 * const { text } = await transcribe("https://www.youtube.com/watch?v=...");
 * const memo = await transcribe("~/Downloads/voice-memo.m4a");
 */
export async function transcribe(input: string, options: TranscribeOptions = {}): Promise<Transcript> {
  const file = await localMediaPath(input);
  const url = file ?? parseVideoUrl(input);
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
    ffmpegPath,
    onProgress = () => {},
    signal,
    timeoutMs,
    ...auth
  } = options;
  const limits = { signal, timeoutMs };

  const workdir = requestedWorkdir ?? (await mkdtemp(join(tmpdir(), "anytranscript-")));
  const ownsWorkdir = !requestedWorkdir;
  const media: string[] = [];

  await mkdir(workdir, { recursive: true });

  try {
    if (file) {
      if (captionsOnly) throw new NoCaptionsError(file, "a file on this computer has no platform captions");
      const engine = await selectBackend(backend, whisperPath);
      onProgress(`file: ${file}`);
      onProgress(`reading the audio track, then transcribing (${engine}, ${model})...`);
      const audio = await extractAudio(file, join(workdir, "audio"), engine === "local" ? "wav16" : "mp3", {
        ffmpegPath,
        ...limits,
      });
      media.push(audio.path);
      const result =
        engine === "local"
          ? await transcribeLocal(audio.path, { model, lang, binary: whisperPath, onProgress, signal })
          : await transcribeHosted(audio.path, engine, { lang, ...limits });
      onProgress(`done via ${engine}, ${result.text.length} chars.`);
      return { ...result, source: "whisper", info: localInfo(file, audio.duration) };
    }

    const bin = await resolveYtDlp(ytdlpPath, onProgress);
    signal?.throwIfAborted();
    const info = await getInfo(bin, url, auth, limits);
    onProgress(`${info.extractor}: "${info.title}"${info.uploader ? ` (${info.uploader})` : ""}`);

    if (!whisperOnly) {
      onProgress("checking for existing captions...");
      const vttPath = await fetchCaptions(bin, url, workdir, lang, {
        ...auth,
        ...limits,
        captionsOnly,
        onProgress,
      });

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

    const audioPath = await downloadAudio(bin, url, workdir, engine === "local" ? "wav16" : "mp3", auth, limits);
    media.push(audioPath);

    const result =
      engine === "local"
        ? await transcribeLocal(audioPath, { model, lang, binary: whisperPath, onProgress, signal })
        : await transcribeHosted(audioPath, engine, { lang, ...limits });

    onProgress(`done via ${engine}, ${result.text.length} chars.`);
    return { ...result, source: "whisper", info };
  } finally {
    if (!keepMedia) {
      if (ownsWorkdir) await rm(workdir, { recursive: true, force: true });
      else await cleanup(...media);
    }
  }
}
