# Contributing

## Getting set up

```bash
npm install
npm run build      # tsc → dist/
npm test           # node --test
npm link           # put `anytranscript` on PATH from this checkout
```

You'll also want `ffmpeg` and `whisper-cpp` (`brew install ffmpeg whisper-cpp`).
yt-dlp downloads itself on first use.

## How this is structured

`src/transcribe.ts` is the orchestrator and the best place to start reading.
Everything else is either an adapter over an external process (`ytdlp.ts`,
`whisper.ts`) or pure logic (`vtt.ts`, `cache.ts`). The README's "How it's
built" section covers the reasoning behind the layout.

## What the tests cover, and what they don't

The unit tests are **offline by design** — they cover the VTT parser and the
download cache, the two places with real logic and no external process. The
yt-dlp and Whisper layers are thin wrappers and are verified by running the
CLI against live URLs.

So: if you touch extraction or transcription, exercise it against a real URL
and say so in the PR. A green `npm test` does not cover those paths, and
saying "tests pass" about a change they never executed is worse than saying
nothing.

## House rules

**Zero runtime dependencies.** `npx` on a cold machine is the main entry
point, so install time is user-facing latency, and every dependency is
supply-chain surface for a tool that can run with browser cookies. If you
genuinely need one, make the case in the PR.

**Never weaken the integrity checks.** Downloads are verified against upstream
checksums before being made executable. If verification fails, fix the cause —
don't add an escape hatch.

**Match the surrounding style.** Comments explain *why*, not *what*. If a
line needs a comment to say what it does, the line is the problem.

## Releasing

Maintainers only — see [RELEASING.md](RELEASING.md).
