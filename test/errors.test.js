import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandError } from "../dist/proc.js";
import { candidateSubLangs } from "../dist/ytdlp.js";
import { NoCaptionsError } from "../dist/transcribe.js";

test("candidateSubLangs tries <lang>-orig before <lang> for plain language codes", () => {
  assert.deepEqual(candidateSubLangs("en"), ["en-orig", "en"]);
  assert.deepEqual(candidateSubLangs("es"), ["es-orig", "es"]);
  assert.deepEqual(candidateSubLangs("en-orig"), ["en-orig"]);
  assert.deepEqual(candidateSubLangs("en,de"), ["en,de"]);
});

test("CommandError includes HTTP 429 rate-limit hint", () => {
  const err = new CommandError(
    "yt-dlp",
    1,
    "ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests\n",
  );
  assert.match(err.message, /HTTP Error 429/);
  assert.match(err.message, /Hint: Rate-limited by the platform/);
  assert.match(err.message, /--cookies-from-browser/);
  assert.match(err.message, /--whisper-only/);
});

test("CommandError includes authentication hint on login-walled errors", () => {
  const err = new CommandError(
    "yt-dlp",
    1,
    "ERROR: [Instagram] Sign in to confirm your age or login required\n",
  );
  assert.match(err.message, /Hint: This video requires authentication/);
  assert.match(err.message, /--cookies-from-browser chrome/);
});

test("CommandError includes ffmpeg hint when ffmpeg is missing", () => {
  const err = new CommandError(
    "yt-dlp",
    1,
    "ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install or provide the path\n",
  );
  assert.match(err.message, /Hint: ffmpeg is required/);
});

test("NoCaptionsError explains how to fall back to Whisper", () => {
  const err = new NoCaptionsError("https://example.com/v");
  assert.match(err.message, /--captions-only/);
  assert.match(err.message, /Whisper/);
});
