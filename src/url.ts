/** Thrown when the input can't be a video link or file, before anything is downloaded. */
export class InvalidUrlError extends Error {
  constructor(
    readonly input: string,
    reason: string,
  ) {
    super(
      `not a valid video URL or file: ${JSON.stringify(input)} (${reason}). ` +
        "Expected a link like https://www.youtube.com/watch?v=VIDEO_ID or the path to a video or audio file",
    );
    this.name = "InvalidUrlError";
  }
}

// Straight, curly and back quotes, plus the <...> some chat apps wrap links in.
const WRAPPERS = /^[\s"'`‘’“”<]+|[\s"'`‘’“”>]+$/g;
const INVISIBLE = /[​-‍⁠﻿]/g;
const KEY_PREFIX = /^\s*["'`‘“]?\s*url\s*[=:]\s*/i;
const TRAILING_PUNCTUATION = /[.,;!?]+$/;
const BARE_HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#:]|$)/i;

/** Drop quotes (straight or curly), a `url=` prefix, spaces and invisible characters. */
export function tidyInput(input: string): string {
  const unwrapped = input.replace(INVISIBLE, "").replace(WRAPPERS, "");
  return unwrapped.replace(KEY_PREFIX, "").replace(WRAPPERS, "");
}

/**
 * Tidy what a person typed or pasted, without judging it: drops quotes (straight
 * or curly), a `url=` prefix, surrounding spaces, invisible characters and
 * trailing sentence punctuation, and adds `https://` to a bare `youtube.com/...`.
 */
export function tidyUrl(input: string): string {
  let url = tidyInput(input).replace(TRAILING_PUNCTUATION, "");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && BARE_HOST.test(url)) url = `https://${url}`;
  return url;
}

/** {@link tidyUrl}, then check it is an http(s) link to a real host. */
export function parseVideoUrl(input: string): string {
  const url = tidyUrl(input);
  if (!url) throw new InvalidUrlError(input, "it is empty");
  if (/\s/.test(url)) throw new InvalidUrlError(input, "it contains spaces; give one link at a time");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidUrlError(input, "it isn't a web address");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new InvalidUrlError(input, `it starts with ${parsed.protocol} instead of https://`);
  }
  if (parsed.hostname !== "localhost" && !parsed.hostname.includes(".")) {
    throw new InvalidUrlError(input, `${parsed.hostname} isn't a website address`);
  }
  return url;
}
