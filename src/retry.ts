/**
 * Which failures are worth retrying, and which mean the whole site wants us
 * to slow down. Used by the bulk scheduler; exported so callers running their
 * own loops can apply the same rules.
 */

import { NoCaptionsError } from "./transcribe.js";

/**
 * Which "site" a URL belongs to, for spacing out requests. Close enough to a
 * registrable domain for throttling: youtu.be and m.youtube.com are both
 * YouTube, vm.tiktok.com is TikTok.
 */
export function siteKey(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "youtu.be") return "youtube.com";
    return host.split(".").slice(-2).join(".");
  } catch {
    return url;
  }
}

const PERMANENT =
  /HTTP Error (400|401|403|404|410)|Video unavailable|This video is unavailable|Private video|Sign in to confirm|login required|members-only|has been removed|Unsupported URL|not a valid URL|checksum mismatch|no speech-to-text backend|is not set/i;
const TRANSIENT =
  /HTTP Error (429|5\d\d)|Too Many Requests|HTTP (429|5\d\d)\b|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EPIPE|socket hang up|fetch failed|Connection (reset|aborted|refused)|Temporary failure in name resolution|IncompleteRead|Remote end closed|Unable to download (webpage|API page)/i;
const RATE_LIMITED = /HTTP Error 429|HTTP 429\b|Too Many Requests|rate.?limit/i;

function describe(error: Error): string {
  const cause = error.cause instanceof Error ? ` ${error.cause.message} ${String((error.cause as { code?: unknown }).code ?? "")}` : "";
  const stderr = "stderr" in error ? ` ${String(error.stderr)}` : "";
  return `${error.message}${cause}${stderr}`;
}

/** Worth another attempt: rate limits, server errors, timeouts, dropped connections. */
export function isRetryable(error: Error): boolean {
  if (error instanceof NoCaptionsError || error.name === "IntegrityError" || error.name === "InvalidUrlError") return false;
  const text = describe(error);
  if (PERMANENT.test(text)) return false;
  return error.name === "TimeoutError" || TRANSIENT.test(text);
}

/** The site is throttling us, so the whole site should back off. */
export function isRateLimited(error: Error): boolean {
  return RATE_LIMITED.test(describe(error));
}
