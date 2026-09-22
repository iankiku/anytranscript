import assert from "node:assert/strict";
import { test } from "node:test";
import { vttToSegments, vttToText } from "../dist/vtt.js";

const AUTO_CAPTIONS = `WEBVTT
Kind: captions
Language: en

00:00:00.320 --> 00:00:02.480
so the thing nobody tells you

00:00:02.480 --> 00:00:04.900
so the thing nobody tells you
about shipping fast

00:00:04.900 --> 00:00:07.120
about shipping fast
is that it compounds
`;

test("collapses the rolling-display duplicates auto-captions emit", () => {
  assert.equal(
    vttToText(AUTO_CAPTIONS),
    "so the thing nobody tells you about shipping fast is that it compounds",
  );
});

test("returns cue timings in seconds", () => {
  const segments = vttToSegments(AUTO_CAPTIONS);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].start, 0.32);
  assert.equal(segments[0].end, 2.48);
  assert.equal(segments[2].text, "is that it compounds");
});

test("strips inline karaoke markup", () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
<00:00:01.250><c>hello</c> <c>there</c>
`;
  assert.equal(vttToText(vtt), "hello there");
});

test("handles MM:SS.mmm timestamps and comma decimals", () => {
  const vtt = `WEBVTT

01:02.500 --> 01:04,000
short form
`;
  const [segment] = vttToSegments(vtt);
  assert.equal(segment.start, 62.5);
  assert.equal(segment.end, 64);
});

test("skips headers, cue indices and empty cues", () => {
  const vtt = `WEBVTT
Kind: captions
Language: en
NOTE this is a comment

1
00:00:00.000 --> 00:00:01.000

2
00:00:01.000 --> 00:00:02.000
real text
`;
  const segments = vttToSegments(vtt);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, "real text");
});

test("empty input yields no segments and empty text", () => {
  assert.deepEqual(vttToSegments("WEBVTT\n"), []);
  assert.equal(vttToText(""), "");
});
