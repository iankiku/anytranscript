#!/usr/bin/env node
// Stands in for ffmpeg. A file named silent.* has no audio track; anything
// else "converts" by writing the arguments it got into the output file.
import { writeFileSync } from "node:fs";
import { basename } from "node:path";

const args = process.argv.slice(2);
if (args.includes("-version") || args.includes("--version")) process.exit(0);

const input = args[args.indexOf("-i") + 1];
console.error(`Input #0, mov,mp4,m4a, from '${input}':\n  Duration: 00:00:19.03, start: 0.000000, bitrate: 128 kb/s`);
if (basename(input).startsWith("silent")) {
  console.error("Stream map '0:a:0' matches no streams.");
  process.exit(1);
}
writeFileSync(args.at(-1), JSON.stringify(args));
