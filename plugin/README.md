# anytranscript plugin for Claude Code and Codex

Transcribe any video URL from inside Claude Code or Codex: YouTube, TikTok,
Instagram and 1,800+ other sites. The agent gets the transcript with timestamps,
saves it as a Markdown document in your working folder (or CSV, Excel or
subtitles), and links it so it opens with a click. No terminal commands needed.

## Install

Claude Code (terminal, desktop app, VS Code):

```bash
claude plugin marketplace add iankiku/anytranscript
claude plugin install anytranscript@anytranscript
```

Codex:

```bash
codex plugin marketplace add iankiku/anytranscript
codex plugin add anytranscript@anytranscript
```

Then ask in plain words:

- "What does this video say about pricing? https://youtu.be/..."
- "Save this talk as Markdown notes with timestamps."
- "Transcribe every link in links.txt into an Excel file each."

## What it adds

- **Two tools:** `transcribe` (one video) and `transcribe_many` (a list, with
  retries and resume). Both return the full path of every file they save.
- **A skill** that tells the agent when to use them, to save a Markdown document
  in your working folder (never a temporary one) and link it by its full path,
  how to read the result, and what to do when a site asks for a login.

## Needs

- Node 20.6 or newer, and `ffmpeg` (`brew install ffmpeg`).
- For videos without captions: whisper.cpp (`brew install whisper-cpp`), or an
  `OPENAI_API_KEY` or `GROQ_API_KEY`.

The plugin runs the published `@iankiku/anytranscript` package through `npx`.
To also have the `ant` command in your terminal, run
`npm install -g @iankiku/anytranscript`.

Full documentation: [github.com/iankiku/anytranscript](https://github.com/iankiku/anytranscript)
