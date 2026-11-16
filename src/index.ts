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
export { formatTranscript, formatFromPath, formatTimestamp, csvField, OUTPUT_FORMATS } from "./format.js";
export type { FormatOptions, OutputFormat } from "./format.js";
export { resolveYtDlp } from "./ytdlp.js";
export { resolveLocalWhisper, ensureModel, selectBackend } from "./whisper.js";
export { runTasks, createLimiter } from "./scheduler.js";
export type { SchedulerEvent, SchedulerOptions, Task, TaskOutcome } from "./scheduler.js";
export { isRetryable, isRateLimited, siteKey } from "./retry.js";
export { CommandError, TimeoutError } from "./proc.js";
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
