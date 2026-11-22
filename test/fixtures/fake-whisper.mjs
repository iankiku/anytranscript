#!/usr/bin/env node
// Stands in for whisper.cpp: reads the "audio" fake-ffmpeg wrote and reports
// whether it was the 16 kHz mono WAV whisper.cpp needs.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version")) process.exit(0);

const audio = JSON.parse(readFileSync(args[args.indexOf("-f") + 1], "utf8"));
const ok = audio.includes("16000") && audio.includes("pcm_s16le") && audio.includes("-vn");
const text = ok ? " hello from a 16k wav" : " wrong audio format";
writeFileSync(`${args[args.indexOf("-of") + 1]}.json`, JSON.stringify({
  result: { language: "en" },
  transcription: [
    { offsets: { from: 1000, to: 3000 }, text },
    { offsets: { from: 15000, to: 18000 }, text: " the end" },
  ],
}));
