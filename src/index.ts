/**
 * anytranscript — text transcripts from Instagram, TikTok and YouTube URLs.
 *
 * @example
 * import { transcribe } from "anytranscript";
 *
 * const { text, segments, source } = await transcribe(url, { model: "small" });
 */

export { transcribe, NoCaptionsError } from "./transcribe.js";
export { InvalidUrlError, parseVideoUrl, tidyUrl } from "./url.js";
export { vttToText, vttToSegments } from "./vtt.js";
export {
  formatTranscript,
  renderTranscript,
  formatFromPath,
  formatTimestamp,
  csvField,
  OUTPUT_FORMATS,
  TEXT_FORMATS,
} from "./format.js";
export type { FormatOptions, OutputFormat, TextFormat } from "./format.js";
export { buildWorkbook, transcriptToXlsx } from "./xlsx.js";
export type { Cell, Sheet } from "./xlsx.js";
export { resolveYtDlp } from "./ytdlp.js";
export { resolveLocalWhisper, ensureModel, selectBackend } from "./whisper.js";
export { runTasks, createLimiter } from "./scheduler.js";
export type { SchedulerEvent, SchedulerOptions, Task, TaskOutcome } from "./scheduler.js";
export { transcribeMany, parseUrlList, transcriptName } from "./batch.js";
export { serveMcp } from "./mcp.js";
export type { BatchEvent, BatchItem, BatchOptions, BatchResult, BatchStatus } from "./batch.js";
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
