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

[Unreleased]: https://github.com/iankiku/anytranscript/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/iankiku/anytranscript/releases/tag/v1.0.0
