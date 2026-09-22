## What changes

<!-- What a user notices. Lead with the outcome, not the implementation. -->

## Why

<!-- The problem this solves. Link an issue if there is one. -->

## How it was verified

<!--
  Say what you actually ran, not what should work. "npm test" alone is
  usually not enough — the unit tests are offline and cover the VTT parser
  and the download cache, so anything touching yt-dlp or Whisper needs a
  real URL exercised.
-->

- [ ] `npm test` passes
- [ ] `npm run build` is clean
- [ ] Exercised against a real URL, if this touches extraction or transcription

## Checklist

- [ ] `CHANGELOG.md` has an entry under `## [Unreleased]`, written for the
      person upgrading
- [ ] README updated, if behaviour or flags changed
- [ ] No new runtime dependencies — this package ships with zero on purpose.
      If one is genuinely needed, say why here.
- [ ] No secrets, cookies, API keys, or private URLs in the diff or output
