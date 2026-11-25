#!/usr/bin/env node
// Stands in for ffmpeg. A file named silent.* has no audio track; anything
// else "converts" by writing the arguments it got into the output file.
// With -vf it writes still frames instead.
import { writeFileSync } from "node:fs";
import { basename } from "node:path";

const args = process.argv.slice(2);
if (args.includes("-version") || args.includes("--version")) process.exit(0);

const input = args[args.indexOf("-i") + 1];
console.error(`Input #0, mov,mp4,m4a, from '${input}':\n  Duration: 00:00:19.03, start: 0.000000, bitrate: 128 kb/s`);
if (args.includes("-vf")) {
  // Frames: three stills at 0, 2.5 and 7 s (fewer with -frames:v), none for
  // an audio-only file. FAKE_FFMPEG_OLD plays ffmpeg 4, which lacks -fps_mode.
  if (process.env.FAKE_FFMPEG_OLD && args.includes("-fps_mode")) {
    console.error("Unrecognized option 'fps_mode'.\nError splitting the argument list: Option not found");
    process.exit(1);
  }
  const cap = Number(args[args.indexOf("-frames:v") + 1]);
  const times = basename(input).startsWith("audioonly") ? [] : [0, 2.5, 7].slice(0, cap);
  times.forEach((time, i) => {
    writeFileSync(args.at(-1).replace("%04d", String(i + 1).padStart(4, "0")), `frame at ${time}`);
    console.error(`[Parsed_showinfo_1 @ 0x1] n:${i} pts:${time * 1000} pts_time:${time} duration:1`);
  });
  process.exit(0);
}
if (basename(input).startsWith("silent")) {
  console.error("Stream map '0:a:0' matches no streams.");
  process.exit(1);
}
writeFileSync(args.at(-1), JSON.stringify(args));
