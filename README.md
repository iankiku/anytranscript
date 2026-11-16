<div align="center">

# anytranscript

**Any social video URL → text.**

Platform captions when they exist. Local Whisper when they don't. One command either way.

<br>

[![npm](https://img.shields.io/npm/v/@iankiku/anytranscript?style=flat-square&color=CC3F3F&label=npm)](https://www.npmjs.com/package/@iankiku/anytranscript) [![downloads](https://img.shields.io/npm/dm/@iankiku/anytranscript?style=flat-square&color=5A6370&label=downloads)](https://www.npmjs.com/package/@iankiku/anytranscript) [![CI](https://img.shields.io/github/actions/workflow/status/iankiku/anytranscript/ci.yml?style=flat-square&color=5A6370&label=CI)](https://github.com/iankiku/anytranscript/actions/workflows/ci.yml) [![node](https://img.shields.io/node/v/@iankiku/anytranscript?style=flat-square&color=5A6370&label=node)](https://nodejs.org) [![deps](https://img.shields.io/badge/runtime%20deps-0-5A6370?style=flat-square)](#how-its-built) [![license](https://img.shields.io/badge/license-MIT-5A6370?style=flat-square)](LICENSE)

[Install](#install) · [How it works](#how-it-works) · [CLI](#cli) · [For agents](#for-agents) · [Library](#library) · [MCP server](#mcp-server) · [How it&#39;s built](#how-its-built)

</div>

---

```console
$ npx @iankiku/anytranscript "https://www.youtube.com/watch?v=jNQXAC9IVRw"

[anytranscript] verified yt-dlp (sha256 0f192b7ec147...)
[anytranscript] Youtube: "Me at the zoo" (jawed)
[anytranscript] checking for existing captions...
[anytranscript] done via captions, 217 chars.

All right, so here we are, in front of the elephants the cool thing about
these guys is that they have really... really really long trunks and that's
cool (baaaaaaaaaaahhh!!) and that's pretty much all there is to say
```

Transcript on stdout, progress on stderr — so `2>/dev/null` always gives you
clean text.

## Platforms

| Platform | Has captions? | What runs |
|---|---|---|
| ![YouTube](https://img.shields.io/badge/YouTube-FF0000?style=flat-square&logo=youtube&logoColor=white) | Usually — manual or auto | **Captions**, deduped |
| ![Instagram](https://img.shields.io/badge/Instagram-E4405F?style=flat-square&logo=instagram&logoColor=white) | Effectively never | Whisper |
| ![TikTok](https://img.shields.io/badge/TikTok-000000?style=flat-square&logo=tiktok&logoColor=white) | Effectively never | Whisper |
| ![X](https://img.shields.io/badge/X-000000?style=flat-square&logo=x&logoColor=white) | Rarely | Usually Whisper |
| ![Reddit](https://img.shields.io/badge/Reddit-FF4500?style=flat-square&logo=reddit&logoColor=white) | No | Whisper |
| ![Vimeo](https://img.shields.io/badge/Vimeo-1AB7EA?style=flat-square&logo=vimeo&logoColor=white) | Sometimes | Either |
| ![Twitch](https://img.shields.io/badge/Twitch-9146FF?style=flat-square&logo=twitch&logoColor=white) | Sometimes | Either |
| ![SoundCloud](https://img.shields.io/badge/SoundCloud-FF5500?style=flat-square&logo=soundcloud&logoColor=white) | No | Whisper |
| **~1,800 more** via yt-dlp | Varies | Either |

Anything [yt-dlp](https://github.com/yt-dlp/yt-dlp) reaches works here — the
list above is just where people actually start.

**You never pick a path.** That middle column is the decision the tool makes
for you on every single run, and the entire design follows from it: captions
are near-instant and free, Whisper costs you a download and some CPU, and
which one you get is a property of the platform rather than a flag you set.

---

## Why this exists

yt-dlp already does the hard part: reaching the video and pulling down a
caption track or an audio stream. This is a wrapper around it, and makes no
claim otherwise.

What it adds is the three things you have to build *after* yt-dlp hands you a
file, and that every caller otherwise rebuilds badly.

### 1. Auto-captions are 3× duplicated, and it isn't obvious

YouTube's auto-generated captions fake a scrolling display by re-emitting each
line across two or three consecutive cues. Strip the timing lines the obvious
way and you get this:

```
This is a three. It's sloppily written This is a three. It's sloppily written
This is a three. It's sloppily written and rendered at an extremely low and
rendered at an extremely low and rendered at an extremely low resolution...
```

Measured on one 20-minute video's auto-caption track:

| | Characters |
|---|---|
| Raw `.vtt` file | 171,557 |
| Naive "drop the timing lines" | 55,319 |
| `anytranscript` | 18,430 |

That's **3.00× duplication** in text that looks superficially fine. Feed it to
an LLM and you pay triple for a transcript that reads like a stutter. Collapsing
it is the single highest-value thing in this package, and it's the part people
don't know they need until they read their own output closely.

### 2. The caption-vs-Whisper branch is per-platform, not per-request

Instagram and TikTok essentially never expose real captions through yt-dlp.
YouTube usually does. So "get me a transcript" is two entirely different
pipelines, and you don't know which one you're in until you've already asked.
This picks for you and falls through automatically.

### 3. Everything downstream of "no captions"

Audio extraction → 16 kHz mono WAV → acquiring Whisper model weights →
invoking the model → parsing its output into timed segments. yt-dlp does none
of that.

### What it deliberately doesn't do

It is not a better downloader, it doesn't work around rate limits or logins
(pass cookies for that), and it doesn't reimplement any extractor. When a site
breaks, that's yt-dlp's surface, and updating yt-dlp is the fix.

---

## How it works

```
                   URL
                    │
         ┌──────────▼──────────┐
         │ yt-dlp: fetch info  │   title, uploader, duration, extractor
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────────┐
         │ captions available?     │   --write-subs --write-auto-subs
         └────┬───────────────┬────┘
         yes  │               │  no  (Instagram, TikTok, most reels)
   ┌──────────▼─────────┐     │
   │ parse .vtt         │     │
   │ collapse rolling   │     │
   │ duplicates         │     │
   └──────────┬─────────┘     │
              │        ┌──────▼────────────────────┐
              │        │ yt-dlp -x → 16kHz mono wav│
              │        └──────┬────────────────────┘
              │        ┌──────▼────────────────────┐
              │        │ Whisper (local or hosted) │
              │        └──────┬────────────────────┘
              │               │
         ┌────▼───────────────▼────┐
         │ { text, segments,       │
         │   source, language,     │
         │   info }                │
         └─────────────────────────┘
```

Manual captions win over auto-generated ones when a video has both. Downloaded
media is deleted when the run ends unless you pass `--keep-media`.

---

## Install

### Run it without installing

```bash
npx @iankiku/anytranscript "<url>"
```

Nothing to set up. Best for one-off use and for agents in throwaway sandboxes.

### Install it as a command

```bash
npm install -g @iankiku/anytranscript
ant "<url>"
```

This installs two names for the same command: `ant` for typing, and
`anytranscript` for scripts that want to be self-explanatory. Apache Ant, the
Java build tool, also installs an `ant` command; if you have both, whichever
comes first on your `PATH` wins, so use `anytranscript` there.

### Add it to a project

```bash
npm install @iankiku/anytranscript
```

Then use it from code (see [Library](#library)), or as `npx anytranscript`
inside that project.

**Required:** Node 20.6+ and `ffmpeg` on PATH.

**For local transcription:** whisper.cpp.

```bash
brew install ffmpeg whisper-cpp
```

No whisper.cpp? Set `OPENAI_API_KEY` or `GROQ_API_KEY` and the audio is
transcribed over the network instead.

**Not** required: a Python runtime, or installing yt-dlp yourself.

### What happens on the first run

Installing fetches nothing beyond the package itself — there's no postinstall
step, so installs stay offline-safe and work in restricted CI. Instead, on the
first run:

1. **yt-dlp** (~30 MB) downloads into `~/.cache/anytranscript/bin`, verified
   against the SHA-256 the yt-dlp project publishes with each release.
2. **Whisper model weights** download into `~/.cache/anytranscript/models`, but
   only if a video actually needs transcribing, and only for the size you asked
   for. `small` (the default) is ~488 MB; `tiny` is ~78 MB.

Both are cached, so it happens once. Already have yt-dlp? Point
`ANYTRANSCRIPT_YTDLP` at it and step 1 is skipped entirely.

---

## CLI

```bash
ant <url> [options]          # same as: anytranscript <url> [options]
```

| Option | Effect |
|---|---|
| `-o, --out <file>` | Write the transcript here instead of stdout. The extension picks the format |
| `-f, --format <fmt>` | `txt` (default) · `md` · `csv` · `json` · `srt` · `vtt` |
| `-t, --timestamps` | `txt` only: one `[mm:ss] text` line per segment |
| `--json <file>` | Also write timestamped segments as JSON |
| `--lang <code>` | Caption/transcription language (default `en`) |
| `--model <size>` | `tiny` · `base` · `small` (default) · `medium` · `large-v3` |
| `--backend <name>` | `auto` (default) · `local` · `openai` · `groq` |
| `--whisper-only` | Skip the caption lookup, always transcribe audio |
| `--captions-only` | Never fall back to Whisper; exit 2 if there are none |
| `--keep-media` | Keep the downloaded audio/caption file |
| `--workdir <dir>` | Where to put downloaded media (default: a temp dir) |
| `--cookies-from-browser <name>` | Borrow cookies from `chrome`, `safari`, `firefox`, `edge`… |
| `--cookies <file>` | Netscape-format `cookies.txt`, as an alternative |
| `-q, --quiet` | Suppress progress output on stderr |
| `-i, --input <file>` | Read URLs from a file, one per line; `-` for stdin |
| `-d, --out-dir <dir>` | Folder for bulk output (default `transcripts`) |
| `-j, --jobs <n>` | Videos at once in bulk mode (default `3`) |
| `--retries <n>` | Retries for temporary failures (default `3`) |
| `--delay <seconds>` | Gap between requests to the same site (default `2`) |
| `--timeout <minutes>` | Stop a stuck download step (default `20`; `0` turns it off) |
| `--force` | Redo videos finished in an earlier run |
| `-h, --help` / `-v, --version` | |

```bash
# Captions if the platform has them, otherwise Whisper
ant "https://www.instagram.com/reel/XXXXXXX/"

# Timestamped lines: [00:05] the cool thing about these guys...
ant "<url>" -t

# Markdown notes, a spreadsheet, or subtitles — the extension decides
ant "<url>" -o notes.md
ant "<url>" -o segments.csv
ant "<url>" -o captions.srt

# Save text and timed segments together
ant "<url>" -o transcript.txt --json segments.json

# Instagram login-walls most reels — borrow a logged-in session
ant "<reel-url>" --cookies-from-browser chrome

# Bigger model when the default mis-hears something
ant "<url>" --model medium
```

### Many videos at once

Pass several URLs, or a file with one URL per line (`#` comments and blank
lines are skipped, and anything after the URL on a line is ignored):

```bash
ant -i urls.txt -f md -d notes        # one Markdown file per video, in notes/
ant "<url1>" "<url2>" "<url3>"        # several URLs on the command line
cat urls.txt | ant -i - -f csv        # or from stdin
```

Each video is written to `notes/` the moment it finishes, named after its
title and id (`me-at-the-zoo-jNQXAC9IVRw.md`). Alongside them:

| File | What's in it |
|---|---|
| `index.csv` | One row per URL ever run into this folder: status, title, channel, duration, source, file, attempts, error |
| `failed.txt` | URLs that failed or didn't finish, ready for `ant -i notes/failed.txt` |
| `manifest.jsonl` | The run log that makes resuming work |

A small scheduler runs the list so one bad URL or a rate limit doesn't sink
the batch:

- **Limited parallelism.** `-j 3` (the default) runs three videos at once.
  Local Whisper still runs one at a time, because whisper.cpp already uses
  every core; downloads for the next videos overlap with it.
- **Polite to each site.** Requests to the same site start at least
  `--delay 2` seconds apart. When a site answers HTTP 429, every queued video
  for that site backs off, and the gap widens.
- **Retries only what's temporary.** Rate limits, 5xx errors, dropped
  connections and timeouts are retried up to `--retries 3` times with
  growing, jittered waits. A deleted, private or unsupported video fails at
  once. A video waiting to retry doesn't hold up the others.
- **No hung runs.** Any single download step that takes longer than
  `--timeout 20` minutes is stopped and retried. Local Whisper is never cut
  off, since slow there means working, not stuck.
- **Resumable.** Run the same command again and finished videos are
  skipped, even after a crash. `--force` redoes them; a different `-f`
  format or `-t` setting counts as not done.
- **Ctrl-C stops cleanly.** Running downloads are cancelled, finished files
  are kept, and the rest go into `failed.txt`. A second Ctrl-C quits at once.

```console
$ ant -i urls.txt -f md -d notes
[anytranscript] 4 videos: 4 to do, 3 at a time.
[anytranscript] [1/4] https://www.youtube.com/watch?v=jNQXAC9IVRw
[anytranscript] [2/4] https://www.youtube.com/watch?v=aqz-KE-bpKQ
[anytranscript] [1/4] ok: Me at the zoo -> notes/me-at-the-zoo-jNQXAC9IVRw.md (captions)
[anytranscript] [4/4] failed: ERROR: [youtube] xxxxxxxxxxx: This video is unavailable
[anytranscript] [2/4] ok: Big Buck Bunny ... -> notes/big-buck-bunny-...-aqz-KE-bpKQ.md (whisper)
[anytranscript] 3 done, 1 failed. Summary: notes/index.csv
[anytranscript] re-run what's left with: ant -i notes/failed.txt -d notes -f md
```

### Export formats

Every format is built from the same timed segments, so captions and Whisper
output export the same way.

| Format | What you get |
|---|---|
| `txt` | The transcript as one paragraph. With `-t`, one `[mm:ss] text` line per segment |
| `md` | Title, source, channel and duration, then paragraphs every ~30 s headed by a timestamp. On YouTube each timestamp links to that moment in the video |
| `csv` | `start,end,timestamp,text`, one row per segment, seconds plus a readable time. Cells that would run as a spreadsheet formula (`=`, `+`, `-`, `@`) get a leading `'` |
| `json` | The full result: `text`, `segments`, `source`, `language`, `info` |
| `srt` / `vtt` | Subtitle files any video player or editor opens |

### Models

`tiny` (fastest, roughest) → `base` → `small` (default) → `medium` →
`large-v3` (slowest, most accurate). The first run at a given size downloads
the weights from Hugging Face and caches them.

### Backends

| `--backend` | What runs | Needs |
|---|---|---|
| `auto` *(default)* | whisper.cpp if installed, else whichever API key is set | — |
| `local` | whisper.cpp — nothing leaves the machine, no per-minute cost | `brew install whisper-cpp` |
| `openai` | `api.openai.com`, `whisper-1` | `OPENAI_API_KEY` |
| `groq` | `api.groq.com`, `whisper-large-v3-turbo` | `GROQ_API_KEY` |

---

## For agents

This CLI is built to be called by an agent, not just a human. The contract:

**Streams are separated.** The transcript goes to **stdout**, and progress and
diagnostics go to **stderr**. So `2>/dev/null` always yields clean text with
nothing to parse around:

```bash
anytranscript "<url>" 2>/dev/null
```

**Exit codes are meaningful.**

| Code | Meaning |
|---|---|
| `0` | Success — transcript on stdout (or written to `--out`) |
| `1` | Failure — video unavailable, bad flag, no backend, network error |
| `2` | `--captions-only` was set and the video has no captions |
| `130` | Bulk run stopped with Ctrl-C; finished files are kept |

**Bulk runs** exit `1` if any URL failed. stdout lists the path of every
transcript the run wrote or found already done, one per line, so
`ant -i urls.txt -d out | xargs cat` works; `out/index.csv` has the
per-URL status and errors.

**Structured output when you need it.** `--json` gives timestamped segments on
**both** paths — captions and Whisper alike — so you can quote a claim with a
timestamp, or window into a long video without re-running anything:

```json
[
  { "start": 4.22, "end": 5.4, "text": "This is a 3." },
  { "start": 6.06, "end": 10.713, "text": "It's sloppily written and rendered..." }
]
```

**Recommended agent invocation:**

```bash
anytranscript "<url>" --json /tmp/segments.json 2>/tmp/progress.log
```

Then read stdout for the text, `/tmp/segments.json` for timing, and only open
`/tmp/progress.log` if the exit code was non-zero.

### Notes for agents specifically

- **Instagram will usually fail without cookies.** On a login/private-content
  error for an `instagram.com` URL, retry once with
  `--cookies-from-browser chrome` before reporting failure.
- **Don't smooth over garbled Whisper output.** If a passage looks wrong, say
  so rather than paraphrasing it into something plausible. The transcript is
  evidence; treat it as such.
- **Prefer `--backend local`** when the content is sensitive — nothing leaves
  the machine, and there's no per-minute cost.
- **Long videos are slow on the Whisper path.** A 20-minute video at `--model
  small` takes minutes on CPU. Prefer the caption path where it exists, and
  raise `--model` only when accuracy actually failed.
- **The first run on a fresh machine downloads yt-dlp (~30 MB) and, on the
  Whisper path, model weights.** Budget for it; subsequent runs are cached.

---

## Library

```ts
import { transcribe } from "@iankiku/anytranscript";

const { text, segments, source, language, info } = await transcribe(url, {
  model: "small",
  backend: "local",
  onProgress: (message) => console.error(message),
});

console.log(info.title, "->", source);   // "Me at the zoo" -> captions
console.log(segments[0]);                // { start: 0, end: 15, text: "..." }
```

### `transcribe(url, options?)`

Returns `Promise<Transcript>`:

```ts
interface Transcript {
  text: string;                        // the full transcript
  segments: Segment[];                 // { start, end, text }, seconds
  source: "captions" | "whisper";      // which path ran
  language: string;
  info: VideoInfo;                     // title, uploader, duration, extractor
}
```

Every CLI flag has an option counterpart: `lang`, `model`, `backend`,
`whisperOnly`, `captionsOnly`, `keepMedia`, `workdir`, `cookiesFromBrowser`,
`cookiesFile`, `ytdlpPath`, `whisperPath`, `onProgress`. Two more for
long-running callers: `signal` (an `AbortSignal` that stops in-flight
downloads and Whisper) and `timeoutMs` (fail any single network step that
runs longer, with a `TimeoutError`).

Throws `NoCaptionsError` when `captionsOnly` finds none, and `CommandError`
(carrying `stderr`) when yt-dlp or whisper.cpp exits non-zero.

### `transcribeMany(urls, options)`

The bulk runner behind `ant -i`. Takes every `transcribe` option plus
`outDir`, `format`, `formatOptions`, `concurrency`, `retries`,
`delaySeconds`, `timeoutMinutes`, `force`, `signal` and `onEvent`. It never
throws for a bad URL; every URL comes back as an item:

```ts
import { transcribeMany } from "@iankiku/anytranscript";

const { items, indexFile, failedFile } = await transcribeMany(urls, {
  outDir: "notes",
  format: "md",
  concurrency: 3,
  onEvent: (event) => event.type === "done" && console.error(event.item.status, event.item.url),
});
// items[i]: { url, status: "ok" | "skipped" | "failed" | "interrupted", file?, title?, error?, attempts }
```

The scheduler itself is exported as `runTasks(tasks, options)`, for queuing
your own work with the same concurrency, per-key spacing, retry and abort
handling.

### `formatTranscript(transcript, format, options?)`

Renders a `Transcript` as any of the CLI's export formats — `"txt"`, `"md"`,
`"csv"`, `"json"`, `"srt"` or `"vtt"` — and returns the file contents as a
string. `options.timestamps` gives timestamped `txt` lines;
`options.paragraphSeconds` sets the Markdown paragraph length (default 30).

```ts
import { formatTranscript, transcribe } from "@iankiku/anytranscript";

const transcript = await transcribe(url);
await writeFile("notes.md", formatTranscript(transcript, "md"));
```

Also exported: `vttToText`, `vttToSegments` (the dedup logic, if you have your
own `.vtt`), `formatFromPath`, `formatTimestamp`, `csvField`, `resolveYtDlp`,
`resolveLocalWhisper`, `ensureModel`, `selectBackend`.

---

## MCP server

Want `transcribe` as a typed tool call for Claude Code, Claude Desktop, or
any other MCP client, instead of shelling out to this CLI? See
[anytranscript-mcp](https://github.com/iankiku/anytranscript-mcp) — a
separate package (`npx @iankiku/anytranscript-mcp`) so this library and CLI
keep their zero-dependency build.

## How it's built

TypeScript, ESM, **no runtime dependencies**. The published package is `dist/`
and this README — nothing is pulled in at install time.

```
src/
  cli.ts          argument parsing (node:util parseArgs) and the exit contract
  transcribe.ts   the orchestrator — the decision tree in "How it works"
  ytdlp.ts        binary resolution, metadata, captions, audio extraction
  whisper.ts      backend selection + whisper.cpp / OpenAI / Groq adapters
  vtt.ts          WEBVTT parsing and the rolling-duplicate collapse
  cache.ts        ~/.cache/anytranscript, resumable downloads
  proc.ts         spawn helpers, CommandError
  types.ts        the public shapes
```

### Design decisions worth knowing

**Shell out to yt-dlp rather than reimplement it.** Every pure-JS YouTube
transcript library scrapes the `timedtext` endpoint directly, which breaks
whenever YouTube changes it and gets IP-blocked at any volume. yt-dlp has
1,800+ maintained extractors and a large community keeping them working.
Updating it is `yt-dlp -U`, not a release of this package.

**Resolve binaries lazily, never at install time.** yt-dlp is looked up in
this order: explicit path → `ANYTRANSCRIPT_YTDLP` → `PATH` → a copy downloaded
into the cache. A postinstall download would break offline installs, CI
sandboxes, and any environment with restricted egress; doing it on first use
keeps `npm install` inert while `npx` still works cold on a fresh machine.

**Downloads land on a `.part` file first.** An interrupted run can otherwise
leave a truncated binary or a half-written model that looks complete forever
after — a failure that reappears on every subsequent run and looks like
corruption rather than an interrupted download.

**Two audio formats, chosen by backend.** whisper.cpp only reads 16 kHz mono,
so the local path extracts directly to that. The hosted APIs charge by upload
size, so those get mp3. Picking per-backend avoids a second transcode.

**Zero runtime dependencies is a deliberate constraint.** `npx` on a cold
machine is the main entry point, so install time is user-facing latency, and
every dependency would be supply-chain surface for a tool that runs with the
user's browser cookies.

### Development

```bash
npm install
npm run build      # tsc → dist/
npm test           # node --test, unit tests over the VTT parser
npm link           # put `anytranscript` on PATH from source
```

The VTT parser is the part with real logic and no I/O, so that's where the
tests are. The yt-dlp and Whisper layers are thin adapters over external
processes and are verified end-to-end against live URLs instead.

---

## Overrides

| Variable | Effect |
|---|---|
| `ANYTRANSCRIPT_YTDLP` | Use this yt-dlp binary instead of resolving one |
| `ANYTRANSCRIPT_WHISPER` | Use this whisper.cpp binary |
| `ANYTRANSCRIPT_WHISPER_JOBS` | Local Whisper runs allowed at once in one process (default `1`; raise it on a GPU machine) |
| `OPENAI_API_KEY` / `GROQ_API_KEY` | Enable the hosted backends |
| `XDG_CACHE_HOME` | Where binaries and model weights are cached |

---

## Limitations

- Instagram login-walls most reels; without cookies those runs fail.
- Whisper on CPU is roughly real-time at `--model small` — a 20-minute video
  takes about 20 minutes. Use the caption path where it exists.
- Speaker diarization ("who said what") isn't supported.
- Language defaults to `en`. Pass `--lang` for anything else; the caption
  lookup needs it to match the track the platform actually published.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: no runtime
dependencies, don't weaken the download integrity checks, and if you touch
extraction or transcription, exercise it against a real URL — the unit tests
are offline and won't cover you.

Security policy and the honest account of what this tool touches (browser
cookies, downloaded binaries, what leaves your machine) is in
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
