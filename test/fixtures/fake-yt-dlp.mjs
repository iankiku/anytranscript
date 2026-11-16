#!/usr/bin/env node
// Stands in for yt-dlp so the CLI can be driven end to end offline. It knows
// two kinds of video: ones with captions, and `v=dead`, which is unavailable.
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("2099.01.01");
  process.exit(0);
}

const url = args.at(-1);
const id = new URL(url).searchParams.get("v") ?? "x";
if (id === "dead") {
  console.error(`ERROR: [youtube] ${id}: Video unavailable`);
  process.exit(1);
}

if (args.includes("--dump-single-json")) {
  console.log(JSON.stringify({ id, title: `Talk ${id}`, uploader: "Fake", duration: 75, webpage_url: url, extractor_key: "Youtube" }));
} else if (args.includes("--write-subs")) {
  const template = args[args.indexOf("-o") + 1];
  const vtt = `WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nhello from ${id}\n\n00:01:05.000 --> 00:01:08.000\nthe end\n`;
  writeFileSync(template.replace("%(id)s.%(ext)s", `${id}.en.vtt`), vtt);
} else {
  console.error("fake yt-dlp: unexpected call");
  process.exit(3);
}
