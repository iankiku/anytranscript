# Security

## Reporting a vulnerability

Report privately through
[GitHub's advisory form](https://github.com/iankiku/anytranscript/security/advisories/new),
not a public issue. Expect an acknowledgement within a few days.

## What this tool touches

Worth understanding before you run it, especially in automation.

**It downloads and executes binaries.** On first use it fetches `yt-dlp` from
the project's GitHub releases and Whisper model weights from Hugging Face, into
`~/.cache/anytranscript`. Both are verified against upstream SHA-256 checksums
before being moved into place or made executable; a mismatch discards the
download and fails. To avoid the download entirely, install yt-dlp yourself and
point `ANYTRANSCRIPT_YTDLP` at it.

**It can read your browser cookies.** `--cookies-from-browser` hands yt-dlp
your logged-in session for a site so it can fetch login-walled content. Those
cookies go to the video platform and nowhere else — this tool has no telemetry
and makes no network calls beyond yt-dlp, the model host, and (only when you
select a hosted backend) that provider. Treat the flag as the credential use it
is: prefer a scoped `--cookies` file over handing over a whole browser profile,
and think twice before using it in shared CI.

**It sends audio off the machine only when you ask.** `--backend local` keeps
everything on your machine. `openai` and `groq` upload the extracted audio to
that provider, under that provider's retention policy. `auto` prefers local and
only falls back to a hosted backend when one has an API key set — so a machine
without whisper.cpp and with a key in the environment will use the network.

**Subprocesses are spawned without a shell.** Arguments are passed as an array,
so a hostile URL or filename cannot inject a command.

**Untrusted output.** A transcript is attacker-controlled text: anyone who can
publish a video controls it. If you pipe it into an LLM, a shell, or anything
that acts on content, treat it as data, never as instructions.

## Supported versions

The latest minor release gets security fixes. Older lines do not.
