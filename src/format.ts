/**
 * Render a Transcript as a file people or tools actually open: plain text,
 * Markdown notes, a spreadsheet, subtitles, or the raw object.
 *
 * Every format here is built from the same timed segments, so captions and
 * Whisper output look identical once exported.
 */

import { extname } from "node:path";
import type { Segment, Transcript } from "./types.js";
import { transcriptToXlsx } from "./xlsx.js";

/** Formats that come out as text, so they can go to stdout or a string. */
export const TEXT_FORMATS = ["txt", "md", "csv", "json", "srt", "vtt"] as const;
export type TextFormat = (typeof TEXT_FORMATS)[number];

/** Every export format; `xlsx` is a binary Excel workbook. */
export const OUTPUT_FORMATS = [...TEXT_FORMATS, "xlsx"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface FormatOptions {
  /** `txt` only: one `[mm:ss] text` line per segment instead of one paragraph. */
  timestamps?: boolean;
  /** `md` only: start a new timestamped paragraph after this many seconds. Default 30. */
  paragraphSeconds?: number;
}

const EXTENSIONS: Record<string, OutputFormat> = {
  ".txt": "txt",
  ".text": "txt",
  ".md": "md",
  ".markdown": "md",
  ".csv": "csv",
  ".json": "json",
  ".srt": "srt",
  ".vtt": "vtt",
  ".xlsx": "xlsx",
};

/** The format a file name implies, or undefined when the extension says nothing. */
export function formatFromPath(path: string): OutputFormat | undefined {
  return EXTENSIONS[extname(path).toLowerCase()];
}

export type TimestampStyle = "clock" | "srt" | "vtt";

/**
 * `clock` is for reading (`01:02`, or `1:02:05` past an hour); `srt` and
 * `vtt` are the fixed-width forms those subtitle formats require.
 */
export function formatTimestamp(seconds: number, style: TimestampStyle, withHours = false): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");

  if (style === "clock") {
    return h > 0 || withHours ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  return `${pad(h)}:${pad(m)}:${pad(s)}${style === "srt" ? "," : "."}${pad(ms, 3)}`;
}

/**
 * One CSV cell, quoted per RFC 4180. Transcripts and titles are untrusted
 * text, and a cell starting with `=`, `+`, `-` or `@` runs as a formula when
 * the file is opened in Excel or Sheets, so those get a leading `'`.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(csvField).join(",");
}

/** Backslash-escape the characters that would turn transcript text into markup. */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>#|]/g, "\\$&");
}

/** A link that opens the video at `seconds`, where the platform supports one. */
function deepLink(transcript: Transcript, seconds: number): string | null {
  const { extractor, id } = transcript.info;
  if (!/^youtube/i.test(extractor) || !id || id === "unknown") return null;
  return `https://youtu.be/${encodeURIComponent(id)}?t=${Math.floor(seconds)}`;
}

/** Use an hour field throughout once any timestamp needs one, so columns line up. */
function needsHours(segments: Segment[]): boolean {
  return segments.some((segment) => segment.end >= 3600);
}

function paragraphs(segments: Segment[], seconds: number): Segment[][] {
  const groups: Segment[][] = [];
  for (const segment of segments) {
    const current = groups.at(-1);
    if (current && segment.start - current[0]!.start < seconds) current.push(segment);
    else groups.push([segment]);
  }
  return groups;
}

function toText(transcript: Transcript, { timestamps = false }: FormatOptions): string {
  const { segments } = transcript;
  if (!timestamps || segments.length === 0) return `${transcript.text}\n`;
  const hours = needsHours(segments);
  return segments.map((s) => `[${formatTimestamp(s.start, "clock", hours)}] ${s.text}\n`).join("");
}

function toMarkdown(transcript: Transcript, { paragraphSeconds = 30 }: FormatOptions): string {
  const { info, segments } = transcript;
  const lines = [`# ${escapeMarkdown(info.title)}`, "", `- **Source:** <${info.webpageUrl}>`];
  if (info.uploader) lines.push(`- **Channel:** ${escapeMarkdown(info.uploader)}`);
  if (info.duration !== null) lines.push(`- **Duration:** ${formatTimestamp(info.duration, "clock")}`);
  lines.push(`- **Transcript:** ${transcript.source}, ${transcript.language}`, "", "## Transcript", "");

  if (segments.length === 0) return `${lines.join("\n")}\n${escapeMarkdown(transcript.text)}\n`;

  const hours = needsHours(segments);
  const body = paragraphs(segments, paragraphSeconds).map((group) => {
    const start = group[0]!.start;
    const stamp = formatTimestamp(start, "clock", hours);
    const link = deepLink(transcript, start);
    const label = link ? `[${stamp}](${link})` : `[${stamp}]`;
    return `**${label}** ${escapeMarkdown(group.map((s) => s.text).join(" "))}`;
  });

  return `${lines.join("\n")}\n${body.join("\n\n")}\n`;
}

function toCsv({ segments }: Transcript): string {
  const rows = segments.map((s) =>
    csvRow([s.start.toFixed(3), s.end.toFixed(3), formatTimestamp(s.start, "vtt"), s.text]),
  );
  return `${["start,end,timestamp,text", ...rows].join("\n")}\n`;
}

/** `-->` inside cue text ends the cue early in both subtitle formats. */
function cueText(text: string): string {
  return text.replace(/-->/g, "->");
}

function toSrt({ segments }: Transcript): string {
  const cues = segments.map(
    (s, i) => `${i + 1}\n${formatTimestamp(s.start, "srt")} --> ${formatTimestamp(s.end, "srt")}\n${cueText(s.text)}`,
  );
  return cues.length ? `${cues.join("\n\n")}\n` : "";
}

function toVtt({ segments }: Transcript): string {
  const cues = segments.map(
    (s) => `${formatTimestamp(s.start, "vtt")} --> ${formatTimestamp(s.end, "vtt")}\n${cueText(s.text)}`,
  );
  return `${["WEBVTT", ...cues].join("\n\n")}\n`;
}

/** Render a transcript as text in one of the TEXT_FORMATS. */
export function formatTranscript(
  transcript: Transcript,
  format: TextFormat,
  options: FormatOptions = {},
): string {
  switch (format) {
    case "txt":
      return toText(transcript, options);
    case "md":
      return toMarkdown(transcript, options);
    case "csv":
      return toCsv(transcript);
    case "json":
      return `${JSON.stringify(transcript, null, 2)}\n`;
    case "srt":
      return toSrt(transcript);
    case "vtt":
      return toVtt(transcript);
  }
}

/** Render a transcript in any format: a string for text, a Buffer for `xlsx`. */
export function renderTranscript(
  transcript: Transcript,
  format: OutputFormat,
  options: FormatOptions = {},
): string | Buffer {
  return format === "xlsx" ? transcriptToXlsx(transcript) : formatTranscript(transcript, format, options);
}
