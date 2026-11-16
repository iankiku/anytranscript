# Working on anytranscript

Instructions for coding agents (and people) changing this repository. If you
want to *use* anytranscript from an agent, read the README's
[For agents](README.md#for-agents) section or install the Claude Code plugin
instead.

## What this is

A zero-dependency Node/TypeScript package that turns a video URL into a
transcript: platform captions through yt-dlp when they exist, Whisper when
they don't. One package ships three ways in:

| Entry | File | Who uses it |
|---|---|---|
| CLI: `ant`, `anytranscript` | `src/cli.ts` | people, shell scripts, agents with a shell |
| MCP server: `ant mcp` | `src/mcp.ts` | agents in Claude Code, Claude Desktop, Cursor... |
| Library | `src/index.ts` | Node code |

The Claude Code plugin in `plugin/` (listed by `.claude-plugin/marketplace.json`)
runs `ant mcp` through `npx` and adds a skill, `plugin/skills/anytranscript/SKILL.md`.

## Map

- `src/transcribe.ts`: one video, captions first, Whisper second. Start here.
- `src/ytdlp.ts`, `src/whisper.ts`, `src/proc.ts`: the external programs.
- `src/format.ts`, `src/xlsx.ts`, `src/zip.ts`: export formats.
- `src/scheduler.ts`, `src/retry.ts`, `src/batch.ts`: bulk runs (queue, retry rules, resume).
- `test/`: offline tests. `test/fixtures/fake-yt-dlp.mjs` stands in for yt-dlp
  so the CLI and MCP server can be driven end to end without a network.

## Commands

```bash
npm ci
npm run build      # tsc into dist/
npm test           # all offline tests; run after building
```

Tests import from `dist/`, so build before testing.

## Rules

1. **No runtime dependencies.** `npx` on a cold machine is the main way in.
   Need one? Make the case in the PR.
2. **Public contracts don't change silently.** These are what scripts and
   agents parse: CLI exit codes, the stdout/stderr split, the `--json` shape,
   and the MCP tool names, inputs and result fields. Changing one is a major
   version.
3. **stdout is for results.** CLI progress goes to stderr. In `ant mcp`,
   stdout carries protocol messages only; one stray `console.log` breaks
   every client.
4. **Never weaken download checks.** Downloads are verified against upstream
   checksums before they run.
5. **Test the real thing.** Write a test that fails without the change. If
   you touch yt-dlp or Whisper code, also run it against a real URL and say
   so in the PR.
6. **Small PRs, one commit each, an issue linked.** Add a line under
   `## [Unreleased]` in `CHANGELOG.md`, written for the person upgrading.
7. **Keep the plugin in step.** `plugin/.claude-plugin/plugin.json` names
   the version being released, and `plugin/.mcp.json` asks for that version
   or newer. `npm test` checks they agree, and a release refuses to publish
   unless the plugin version equals `package.json`.

Releases: see [RELEASING.md](RELEASING.md).
