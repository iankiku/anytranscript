import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandError, TimeoutError } from "../dist/proc.js";
import { isRateLimited, isRetryable, siteKey } from "../dist/retry.js";
import { NoCaptionsError } from "../dist/transcribe.js";

test("siteKey groups a platform's hostnames together", () => {
  assert.equal(siteKey("https://www.youtube.com/watch?v=1"), "youtube.com");
  assert.equal(siteKey("https://m.youtube.com/watch?v=1"), "youtube.com");
  assert.equal(siteKey("https://youtu.be/1"), "youtube.com");
  assert.equal(siteKey("https://vm.tiktok.com/ZM123/"), "tiktok.com");
  assert.equal(siteKey("not a url"), "not a url");
});

test("isRetryable retries throttling, server errors and network drops, never dead videos", () => {
  const ytdlp = (stderr) => new CommandError("yt-dlp", 1, stderr);
  assert.equal(isRetryable(ytdlp("ERROR: HTTP Error 429: Too Many Requests")), true);
  assert.equal(isRetryable(ytdlp("ERROR: Unable to download webpage: HTTP Error 502: Bad Gateway")), true);
  assert.equal(isRetryable(ytdlp("ERROR: Unable to download webpage: <urlopen error [Errno 54] Connection reset by peer>")), true);
  assert.equal(isRetryable(new TimeoutError("yt-dlp", 60_000)), true);
  assert.equal(isRetryable(new Error("groq transcription failed: HTTP 429 slow down")), true);
  assert.equal(isRetryable(new TypeError("fetch failed", { cause: Object.assign(new Error("read"), { code: "ECONNRESET" }) })), true);

  assert.equal(isRetryable(ytdlp("ERROR: [youtube] x: Video unavailable")), false);
  assert.equal(isRetryable(ytdlp("ERROR: Unable to download webpage: HTTP Error 404: Not Found")), false);
  assert.equal(isRetryable(ytdlp("ERROR: [Instagram] x: login required")), false);
  assert.equal(isRetryable(ytdlp("ERROR: Unsupported URL: https://example.com")), false);
  assert.equal(isRetryable(new NoCaptionsError("u")), false);
  assert.equal(isRetryable(new Error("something unexpected")), false);
});

test("isRateLimited spots throttling from yt-dlp and from hosted Whisper", () => {
  assert.equal(isRateLimited(new CommandError("yt-dlp", 1, "HTTP Error 429: Too Many Requests")), true);
  assert.equal(isRateLimited(new Error("openai transcription failed: HTTP 429 {}")), true);
  assert.equal(isRateLimited(new CommandError("yt-dlp", 1, "HTTP Error 503")), false);
});
