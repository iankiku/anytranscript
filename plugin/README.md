# anytranscript plugin for Claude Code

Transcribe any video URL from inside Claude Code: YouTube, TikTok, Instagram and
1,800+ other sites. Claude gets the transcript with timestamps, can save it as
Markdown, CSV, Excel or subtitles, and tells you where the file is. No terminal
commands needed.

## Install

```bash
claude plugin marketplace add iankiku/anytranscript
claude plugin install anytranscript@anytranscript
```

Then ask in plain words:

- "What does this video say about pricing? https://youtu.be/..."
- "Save this talk as Markdown notes with timestamps."
- "Transcribe every link in links.txt into an Excel file each."

## What it adds

- **Two tools:** `transcribe` (one video) and `transcribe_many` (a list, with
  retries and resume). Both return the full path of every file they save.
- **A skill** that tells Claude when to use them, how to read the result, and
  what to do when a site asks for a login.

## Needs

- Node 20.6 or newer, and `ffmpeg` (`brew install ffmpeg`).
- For videos without captions: whisper.cpp (`brew install whisper-cpp`), or an
  `OPENAI_API_KEY` or `GROQ_API_KEY`.

The plugin runs the published `@iankiku/anytranscript` package through `npx`.
To also have the `ant` command in your terminal, run
`npm install -g @iankiku/anytranscript`.

Full documentation: [github.com/iankiku/anytranscript](https://github.com/iankiku/anytranscript)
