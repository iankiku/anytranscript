/**
 * Minimal WEBVTT parser. Auto-generated captions repeat lines across cues to
 * fake a rolling display, so the same sentence shows up two or three times in
 * a row — collapsing those duplicates is most of the work here.
 */

import type { Segment } from "./types.js";

const TAG = /<[^>]+>/g;
const CUE_TIMING = /^((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})/;
const HEADER = /^(WEBVTT|Kind|Language|Style|NOTE|Region)\b/i;

/** `00:01:02.500` or `01:02.500` -> seconds. */
function parseTimestamp(stamp: string): number {
  const parts = stamp.replace(",", ".").split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function stripMarkup(line: string): string {
  return line.replace(TAG, "").trim();
}

/** Parse cues, dropping the rolling-display duplicates as we go. */
export function vttToSegments(vtt: string): Segment[] {
  const segments: Segment[] = [];
  const lines = vtt.split(/\r?\n/);
  let previous = "";

  for (let i = 0; i < lines.length; i++) {
    const timing = CUE_TIMING.exec(lines[i]!.trim());
    if (!timing) continue;

    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!.trim();
      // A cue ends at a blank line or at the next cue's timing/index line.
      if (!line || CUE_TIMING.test(line) || HEADER.test(line)) break;
      if (/^\d+$/.test(line)) continue;

      const text = stripMarkup(line);
      if (text && text !== previous) {
        body.push(text);
        previous = text;
      }
    }

    if (body.length) {
      segments.push({
        start: parseTimestamp(timing[1]!),
        end: parseTimestamp(timing[2]!),
        text: body.join(" "),
      });
    }
  }

  return segments;
}

export function vttToText(vtt: string): string {
  return vttToSegments(vtt)
    .map((segment) => segment.text)
    .join(" ")
    .trim();
}
