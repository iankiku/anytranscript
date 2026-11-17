import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidUrlError, parseVideoUrl, tidyUrl } from "../dist/index.js";
import { isRetryable } from "../dist/retry.js";

const LINK = "https://www.youtube.com/watch?v=wr6PMD06hP0";

test("quotes, url= prefixes, spaces and angle brackets are tidied away", () => {
  for (const input of [
    LINK,
    `"${LINK}"`,
    `'${LINK}'`,
    `“${LINK}”`,
    `‘${LINK}’`,
    `<${LINK}>`,
    `  ${LINK}  `,
    `url=${LINK} `,
    `url="${LINK} "`,
    `URL: ${LINK}`,
    `${LINK}.`,
    `​${LINK}﻿`,
  ]) {
    assert.equal(parseVideoUrl(input), LINK, `input ${JSON.stringify(input)}`);
  }
});

test("a bare youtube.com or youtu.be link gets https://", () => {
  assert.equal(parseVideoUrl("youtube.com/watch?v=abc"), "https://youtube.com/watch?v=abc");
  assert.equal(parseVideoUrl("youtu.be/abc"), "https://youtu.be/abc");
  assert.equal(tidyUrl("www.tiktok.com/@a/video/1"), "https://www.tiktok.com/@a/video/1");
});

test("things that aren't links fail with a reason and an example", () => {
  const cases = [
    ["", /it is empty/],
    ['""', /it is empty/],
    ["hello", /isn't a web address/],
    ["ftp://example.com/v.mp4", /starts with ftp: instead of https:\/\//],
    ["https://localhostish/v", /isn't a website address/],
    [`${LINK} ${LINK}`, /contains spaces/],
  ];
  for (const [input, reason] of cases) {
    assert.throws(
      () => parseVideoUrl(input),
      (error) => error instanceof InvalidUrlError && reason.test(error.message) && /youtube\.com\/watch\?v=VIDEO_ID/.test(error.message),
      `input ${JSON.stringify(input)}`,
    );
  }
});

test("a bad link is never retried", () => {
  assert.equal(isRetryable(new InvalidUrlError("x", "it isn't a web address")), false);
});
