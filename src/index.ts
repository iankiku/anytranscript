/**
 * anytranscript — text transcripts from Instagram, TikTok and YouTube URLs.
 *
 * @example
 * import { transcribe } from "anytranscript";
 *
 * const { text, segments, source } = await transcribe(url, { model: "small" });
 */

export { transcribe, NoCaptionsError } from "./transcribe.js";
export { vttToText, vttToSegments } from "./vtt.js";
export { resolveYtDlp } from "./ytdlp.js";
export { resolveLocalWhisper, ensureModel, selectBackend } from "./whisper.js";
export { CommandError } from "./proc.js";
export type {
  AuthOptions,
  ModelSize,
  Segment,
  Transcript,
  TranscribeOptions,
  TranscriptSource,
  VideoInfo,
  WhisperBackend,
} from "./types.js";
