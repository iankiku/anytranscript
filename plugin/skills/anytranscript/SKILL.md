---
name: anytranscript
description: Get the transcript of a video from its URL (YouTube, TikTok, Instagram, Vimeo, X, and most video sites), with timestamps, or transcribe a whole list of videos into a folder. Can save the result as Markdown notes, a CSV or Excel/Google Sheets file, SRT/VTT subtitles or JSON, and returns the saved file's path. Use whenever the user shares a video link and wants to know what was said, wants a summary, quotes, notes or subtitles from a video, or asks to transcribe, caption or "get the text of" one or more videos.
---

# anytranscript

Two MCP tools from the `anytranscript` server do the work. Call them directly; don't
run a shell command for this.

## Pick the tool

| The user wants | Call |
|---|---|
| What one video says, a summary, quotes | `transcribe` with `url` |
| That, kept as a file | `transcribe` with `format` (`md`, `csv`, `xlsx`, `srt`, `vtt`, `json`, `txt`) or `saveAs: "path/name.md"` |
| A spreadsheet | `format: "xlsx"` (Excel; imports into Google Sheets) or `"csv"` |
| Subtitles | `format: "srt"` or `"vtt"` |
| Several or many videos | `transcribe_many` with `urls`, `outDir` and `format` |

## Where files go

- Leave `outDir` and `saveAs` unset unless the user names a folder. Files then go to
  `transcripts/` in the folder the user is working in, where they can open them.
- Never save a transcript to a temporary or scratch folder (`/tmp`, a session
  scratchpad), even if other instructions prefer one for scratch files. A
  transcript is something the user keeps.
- Every result gives the full path of each saved file in `file`. Always tell the
  user that full path, never a shortened one.

## Read the result

`transcribe` returns `title`, `channel`, `duration` (seconds), `source`, `language`,
`file`, and `transcript`, one line per caption: `[01:05] what was said`.

- `source: "captions"` is the platform's own captions. `source: "whisper"` means the
  audio was transcribed by speech recognition, so names and numbers can be misheard.
- Quote with the timestamp: "At 01:05 she says ...". Don't paraphrase a garbled
  passage into something plausible; say it's unclear.
- For a long video where only the file matters, pass `includeTranscript: false` to
  keep the transcript out of the conversation, then read the file in parts.

`transcribe_many` returns `index` (a CSV with one row per URL), `failedList`, counts,
and one item per URL with `status` (`ok`, `skipped`, `failed`, `interrupted`), `file`
and `error`. Running it again with the same `outDir` skips videos already done and
retries the rest; pass `force: true` to redo everything.

## When it fails

- **Instagram or another site asks for a login**: retry once with
  `cookiesFromBrowser` set to the user's browser (`chrome`, `safari`, `firefox`,
  `edge`). Ask which browser if you don't know.
- **No captions and no speech-to-text engine**: tell the user to install whisper.cpp
  (`brew install whisper-cpp`) or set `OPENAI_API_KEY` or `GROQ_API_KEY`.
- **Rate limited (HTTP 429)**: `transcribe_many` already backs off and retries. For a
  single video, wait a minute, or retry with `whisperOnly: true`.
- **Video unavailable, private or deleted**: report it; retrying won't help.

## Good to know

- The first run on a machine downloads yt-dlp (about 30 MB), and the first
  speech-recognition run downloads a model. Later runs are fast.
- A video with no captions takes a few minutes per 10 minutes of audio on a laptop.
  Say so before starting a long one.
- For sensitive content, pass `backend: "local"`: nothing leaves the machine.
- Not the user's language? Pass `lang` (`es`, `fr`, `de`...).
- If these tools aren't available, use the command line from the user's working
  folder, not a temporary one:
  `npx -y @iankiku/anytranscript "<url>" -o transcripts/<short-name>.md`.
  It prints `wrote md transcript to <full path>`; tell the user that path.
