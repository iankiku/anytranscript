/** Shared shapes for the public API. */

export interface VideoInfo {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  webpageUrl: string;
  extractor: string;
}

/** One timed chunk of speech. Times are seconds from the start of the media. */
export interface Segment {
  start: number;
  end: number;
  text: string;
}

/** Where the text came from: the platform's own captions, or speech-to-text. */
export type TranscriptSource = "captions" | "whisper";

export interface Transcript {
  text: string;
  source: TranscriptSource;
  language: string;
  segments: Segment[];
  info: VideoInfo;
}

/**
 * `local` shells out to whisper.cpp, `openai` and `groq` post the audio to a
 * hosted endpoint. `auto` prefers whisper.cpp and falls back to whichever
 * hosted provider has an API key in the environment.
 */
export type WhisperBackend = "auto" | "local" | "openai" | "groq";

export type ModelSize = "tiny" | "base" | "small" | "medium" | "large-v3";

export interface AuthOptions {
  /** Read cookies from an installed browser: chrome, safari, firefox, edge... */
  cookiesFromBrowser?: string;
  /** Path to a Netscape-format cookies.txt file. */
  cookiesFile?: string;
}

export interface TranscribeOptions extends AuthOptions {
  /** Caption/transcription language code. Defaults to `en`. */
  lang?: string;
  /** Whisper model size for the speech-to-text path. Defaults to `small`. */
  model?: ModelSize;
  /** Which speech-to-text engine to use. Defaults to `auto`. */
  backend?: WhisperBackend;
  /** Skip the caption lookup and always transcribe the audio. */
  whisperOnly?: boolean;
  /** Never fall back to Whisper; throw if the video has no captions. */
  captionsOnly?: boolean;
  /** Leave downloaded media on disk instead of deleting it. */
  keepMedia?: boolean;
  /** Directory for downloaded media. Defaults to a fresh temp dir. */
  workdir?: string;
  /** Override the yt-dlp binary instead of letting it be resolved. */
  ytdlpPath?: string;
  /** Override the whisper.cpp binary instead of letting it be resolved. */
  whisperPath?: string;
  /** Called with human-readable progress lines. */
  onProgress?: (message: string) => void;
  /** Cancel the run: in-flight yt-dlp, whisper.cpp and upload steps are stopped. */
  signal?: AbortSignal;
  /**
   * Give up on any single network step (a yt-dlp call or a hosted upload)
   * that takes longer than this, with a TimeoutError. Local Whisper is CPU
   * work, not a stalled request, so it is never cut off. Default: no limit.
   */
  timeoutMs?: number;
}
