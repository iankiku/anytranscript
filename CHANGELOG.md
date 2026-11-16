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

### Added

- A short command, `ant`. `ant <url>` does exactly what `anytranscript <url>`
  does; both names are installed, so existing scripts keep working.
- Export formats. `-f, --format` takes `txt`, `md`, `csv`, `json`, `srt` or
  `vtt`, and `-o notes.md` (or `.csv`, `.srt`...) picks the format from the
  extension. Markdown has a metadata header and timestamped paragraphs that
  link to the moment in the video on YouTube; CSV has one row per segment.
- `-t, --timestamps` prints one `[mm:ss] text` line per segment instead of a
  single paragraph.
- `formatTranscript()` in the library, for the same formats from code.
- `runTasks()` in the library: a small job scheduler with a concurrency
  limit, spacing between jobs for the same site, a site-wide back-off after a
  rate limit, retries with jittered exponential backoff, and clean abort.
  It is the groundwork for bulk transcription.
- `signal` and `timeoutMs` options on `transcribe()`. An `AbortSignal` stops
  in-flight yt-dlp, whisper.cpp and upload steps; `timeoutMs` fails any single
  network step that runs longer with a `TimeoutError`. Local Whisper is never
  cut off by the timeout.
- `isRetryable()`, `isRateLimited()` and `siteKey()`: the rules for which
  failures are worth another attempt, for callers running their own loops.

### Changed

- `-o <file>` now ends the file with a newline, like stdout already did.
- Local whisper.cpp runs now queue one at a time within a process, since
  each already uses every core. `ANYTRANSCRIPT_WHISPER_JOBS` raises the limit.

### Fixed

- Running several transcriptions at once on a fresh machine could start
  duplicate downloads of yt-dlp or a Whisper model into the same partial
  file. Concurrent callers now share one download, and each process writes
  its own partial file.
- Two local Whisper runs started in the same millisecond could read each
  other's output file.
- A caption request that timed out or was cancelled fell through to a full
  Whisper run instead of stopping.

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
