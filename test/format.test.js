import assert from "node:assert/strict";
import { test } from "node:test";
import {
  csvField,
  formatFromPath,
  formatTimestamp,
  formatTranscript,
} from "../dist/format.js";

const youtube = {
  text: "Hello there. General Kenobi. You are a bold one.",
  source: "captions",
  language: "en",
  segments: [
    { start: 0.5, end: 2.25, text: "Hello there." },
    { start: 31.0, end: 33.5, text: "General Kenobi." },
    { start: 62.125, end: 65.0, text: "You are a bold one." },
  ],
  info: {
    id: "abc123",
    title: "A *bold* [one]",
    uploader: "Grievous",
    duration: 65,
    webpageUrl: "https://www.youtube.com/watch?v=abc123",
    extractor: "Youtube",
  },
};

const tiktok = {
  ...youtube,
  source: "whisper",
  info: { ...youtube.info, extractor: "TikTok", webpageUrl: "https://www.tiktok.com/@u/video/1" },
};

test("formatTimestamp renders clock, srt and vtt styles", () => {
  assert.equal(formatTimestamp(62.125, "clock"), "01:02");
  assert.equal(formatTimestamp(3725.5, "clock"), "1:02:05");
  assert.equal(formatTimestamp(62.125, "clock", true), "0:01:02");
  assert.equal(formatTimestamp(62.125, "srt"), "00:01:02,125");
  assert.equal(formatTimestamp(3725.5, "vtt"), "01:02:05.500");
  assert.equal(formatTimestamp(0.9996, "vtt"), "00:00:01.000");
});

test("formatFromPath infers the format from the file extension", () => {
  assert.equal(formatFromPath("talk.md"), "md");
  assert.equal(formatFromPath("talk.MARKDOWN"), "md");
  assert.equal(formatFromPath("out/talk.csv"), "csv");
  assert.equal(formatFromPath("talk.srt"), "srt");
  assert.equal(formatFromPath("talk.vtt"), "vtt");
  assert.equal(formatFromPath("talk.json"), "json");
  assert.equal(formatFromPath("talk.txt"), "txt");
  assert.equal(formatFromPath("talk.XLSX"), "xlsx");
  assert.equal(formatFromPath("talk"), undefined);
  assert.equal(formatFromPath("talk.docx"), undefined);
});

test("txt is the plain transcript by default, one timed line per segment with timestamps", () => {
  assert.equal(formatTranscript(youtube, "txt"), `${youtube.text}\n`);
  assert.equal(
    formatTranscript(youtube, "txt", { timestamps: true }),
    "[00:00] Hello there.\n[00:31] General Kenobi.\n[01:02] You are a bold one.\n",
  );
});

test("md has a metadata header, escapes untrusted text, and deep-links YouTube timestamps", () => {
  const md = formatTranscript(youtube, "md");
  assert.match(md, /^# A \\\*bold\\\* \\\[one\\\]\n/);
  assert.match(md, /- \*\*Source:\*\* <https:\/\/www\.youtube\.com\/watch\?v=abc123>/);
  assert.match(md, /- \*\*Channel:\*\* Grievous/);
  assert.match(md, /- \*\*Duration:\*\* 01:05/);
  assert.match(md, /- \*\*Transcript:\*\* captions, en/);
  // 30-second paragraphs: each segment here starts its own paragraph.
  assert.match(md, /\*\*\[00:00\]\(https:\/\/youtu\.be\/abc123\?t=0\)\*\* Hello there\.\n\n/);
  assert.match(md, /\*\*\[01:02\]\(https:\/\/youtu\.be\/abc123\?t=62\)\*\* You are a bold one\.\n$/);
});

test("md groups short segments into paragraphs and uses plain timestamps off YouTube", () => {
  const md = formatTranscript(tiktok, "md", { paragraphSeconds: 60 });
  assert.match(md, /\*\*\[00:00\]\*\* Hello there\. General Kenobi\.\n\n\*\*\[01:02\]\*\* You are a bold one\.\n$/);
});

test("csv quotes per RFC 4180 and neutralises spreadsheet formulas", () => {
  const tricky = {
    ...youtube,
    segments: [
      { start: 1, end: 2, text: 'She said "hi", then left' },
      { start: 2, end: 3, text: "=HYPERLINK(\"http://evil\")" },
      { start: 3, end: 4, text: "- next speaker" },
    ],
  };
  assert.equal(
    formatTranscript(tricky, "csv"),
    "start,end,timestamp,text\n" +
      '1.000,2.000,00:00:01.000,"She said ""hi"", then left"\n' +
      "2.000,3.000,00:00:02.000,\"'=HYPERLINK(\"\"http://evil\"\")\"\n" +
      "3.000,4.000,00:00:03.000,'- next speaker\n",
  );
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField("a\nb"), '"a\nb"');
  assert.equal(csvField("+1"), "'+1");
  assert.equal(csvField(null), "");
  assert.equal(csvField(12.5), "12.5");
});

test("srt and vtt are valid subtitle files", () => {
  assert.equal(
    formatTranscript(youtube, "srt"),
    "1\n00:00:00,500 --> 00:00:02,250\nHello there.\n\n" +
      "2\n00:00:31,000 --> 00:00:33,500\nGeneral Kenobi.\n\n" +
      "3\n00:01:02,125 --> 00:01:05,000\nYou are a bold one.\n",
  );
  const vtt = formatTranscript(
    { ...youtube, segments: [{ start: 0, end: 1, text: "a --> b" }] },
    "vtt",
  );
  assert.equal(vtt, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\na -> b\n");
});

test("json is the full Transcript object", () => {
  assert.deepEqual(JSON.parse(formatTranscript(youtube, "json")), youtube);
});

test("formats without segments fall back to the plain text", () => {
  const bare = { ...tiktok, segments: [] };
  assert.equal(formatTranscript(bare, "txt", { timestamps: true }), `${bare.text}\n`);
  assert.match(formatTranscript(bare, "md"), /## Transcript\n\nHello there\. General Kenobi\./);
});
