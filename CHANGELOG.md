# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
  Keep an "Unreleased" section at the top and add entries to it as you merge.
  At release time, rename it to the version and date, then start a fresh
  Unreleased block. Sections, in this order, omitting any that are empty:

  ### Added        new capability
  ### Changed      behaviour that differs from the last release
  ### Deprecated   still works, will be removed
  ### Removed      gone as of this release
  ### Fixed        a defect that is no longer present
  ### Security     anything with a security consequence

  Write entries for the person upgrading, not for the person who wrote the
  patch: say what changes for them, and what they have to do about it.
-->

## [Unreleased]

## [1.1.0] - 2026-11-15

Shorter command, more ways to save a transcript, whole lists of videos at
once, and tools that agents can call directly. Nothing existing breaks.

### Added

- **`ant`**, a short name for the command. `anytranscript` still works.
  Apache Ant also installs an `ant` command; where both exist, the first on
  your `PATH` wins.
- **Save as a file.** `-o notes.md` picks the format from the file name:
  Markdown, CSV, Excel (`.xlsx`), SRT or VTT subtitles, JSON or text. `-f`
  picks it directly. Markdown starts with the title, link and length, then
  timestamped paragraphs that link to that moment on YouTube.
- **Excel and Google Sheets.** `.xlsx` files have a Transcript tab (one row
  per caption, times as numbers) and a Video tab. Text is always stored as
  text, never as a formula.
- **Timestamps.** `-t` prints one `[mm:ss] text` line per caption.
- **Many videos at once.** `ant -i urls.txt -d notes -f md` saves one file per
  video, plus `index.csv` (and `index.xlsx` with `-f xlsx`) and `failed.txt`.
  It runs 3 videos at a time (`-j`), waits between requests to the same site
  (`--delay`), backs off when a site blocks it, retries only temporary
  errors (`--retries`), and stops stuck downloads (`--timeout`). Run the same
  command again to carry on where it stopped; Ctrl-C keeps finished files.
- **For agents: `ant mcp`**, an MCP server in the same package, with two
  tools, `transcribe` and `transcribe_many`. They return the transcript with
  timestamps, the video's details, and the full path of every saved file.
- **For agents: a Claude Code plugin.**
  `claude plugin marketplace add iankiku/anytranscript`, then
  `claude plugin install anytranscript@anytranscript`.
- **For library users:** `formatTranscript()`, `renderTranscript()`,
  `transcribeMany()`, `runTasks()`, `isRetryable()`, `serveMcp()`, and
  `signal` and `timeoutMs` options on `transcribe()`.

### Changed

- Giving more than one URL now transcribes them all. Before, everything
  after the first was ignored.
- `-o <file>` now ends the file with a newline, like stdout already did.
- Local Whisper runs one video at a time per process, since it already uses
  every core. `ANYTRANSCRIPT_WHISPER_JOBS` raises the limit.

### Fixed

- Several runs starting at once on a fresh machine could download yt-dlp or
  a Whisper model into the same half-written file. They now share one
  download.
- Two local Whisper runs started in the same millisecond could read each
  other's output.
- A caption request that timed out turned into a full Whisper run instead of
  stopping.

## [1.0.2] - 2026-10-19

### Fixed

- YouTube videos with only auto-generated captions could fail with `HTTP Error
  429: Too Many Requests` instead of returning a transcript. YouTube stores a
  video's original auto-captions under `<lang>-orig` (for example `en-orig`)
  and reserves `<lang>` for auto-translated tracks, which are heavily
  rate-limited. Caption lookup now tries `<lang>-orig` first and falls back to
  `<lang>`, and if caption download still fails, it falls through to Whisper
  audio transcription instead of crashing the run (unless `--captions-only` is
  set).

### Changed

- Error messages from `yt-dlp` and `ffmpeg` now include plain-English hints on
  how to recover — for example, passing `--cookies-from-browser chrome` or
  `--whisper-only` when rate-limited (HTTP 429), passing browser cookies when a
  video requires sign-in, or installing `ffmpeg` when audio extraction fails.

## [1.0.1] - 2026-09-27

### Fixed

- `dist/cli.js` wasn't marked executable after a plain `tsc` build. It didn't
  surface locally (`npm link` and repeated `npx` runs reuse a cache entry that
  was already executable from an earlier build), but it could break a fresh
  global install or a cold `npx` run on some setups. `npm run build` now
  `chmod +x`'s it as part of the build step.

### Changed

- Broadened discoverability on npm and GitHub: the package description and
  keywords now name the underlying tech people actually search for (Whisper,
  whisper.cpp, yt-dlp, VTT) and the use cases this gets built into (agent
  tooling, RAG, LLM pipelines). Added matching GitHub topics, a repo
  description, and a homepage link. No behavior change.

## [1.0.0] - 2026-09-22

First public release. The tool existed as a private Python script before this;
that history is not covered here.

### Added

- `anytranscript <url>` — transcripts from Instagram, TikTok, YouTube, and
  anything else yt-dlp reaches. Platform captions when they exist, Whisper
  speech-to-text when they don't.
- Collapses the rolling-display duplication in auto-generated captions, which
  otherwise inflates a transcript by roughly 3×.
- Timestamped segments via `--json`, on both the caption and Whisper paths.
- Three Whisper backends behind `--backend`: local whisper.cpp, OpenAI, and
  Groq, with `auto` preferring whatever is available.
- Typed library API — `transcribe()`, plus `vttToText` / `vttToSegments` for
  callers that already have a `.vtt`.
- yt-dlp and Whisper model weights resolve and download on first use, so
  `npm install` stays offline-safe and `npx` works on a cold machine.

### Security

- Downloaded binaries and model weights are verified against upstream SHA-256
  checksums — yt-dlp's published `SHA2-256SUMS`, and Hugging Face's
  `x-linked-etag` — before being moved into the cache or made executable. A
  mismatch discards the download and fails loudly.
- No runtime dependencies, so the package carries no transitive supply-chain
  surface of its own.

[Unreleased]: https://github.com/iankiku/anytranscript/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/iankiku/anytranscript/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/iankiku/anytranscript/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/iankiku/anytranscript/releases/tag/v1.0.0
