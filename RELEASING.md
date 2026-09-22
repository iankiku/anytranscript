# Releasing

Publishing is driven by a version tag. CI builds, tests, verifies the tarball,
and publishes with npm provenance, so the released artifact is traceable to the
exact commit and workflow run that produced it.

## One-time setup

1. **npm automation token.** On npmjs.com → Access Tokens → Generate →
   **Automation** (it bypasses 2FA, which is what CI needs). Add it to the repo
   as the `NPM_TOKEN` secret.
2. **A `release` environment** in repo settings. Add yourself as a required
   reviewer so a publish needs a human click even if a tag is pushed by mistake.

## Cutting a release

```bash
# 1. Move the Unreleased entries into a new version section, dated today.
$EDITOR CHANGELOG.md

# 2. Bump the version. This commits and tags in one step.
npm version patch        # or minor / major

# 3. Push the commit and the tag.
git push --follow-tags
```

The tag push triggers `.github/workflows/release.yml`, which refuses to publish
if the tag disagrees with `package.json`, or if `CHANGELOG.md` has no section
for the version being released.

To rehearse without publishing, run the workflow manually from the Actions tab
with **dry run** left checked.

## Choosing the number

- **patch** — a fix, no behaviour change for anyone already using it correctly.
- **minor** — a new flag, backend, or export. Nothing existing breaks.
- **major** — a removed or renamed flag, a changed default, a changed return
  shape, or a raised minimum Node version.

Treat the **exit codes, the stdout/stderr split, and the `--json` shape** as
public API. Agents parse them, and breaking any of the three silently breaks
callers that never see a deprecation warning.

## After publishing

```bash
npm view @iankiku/anytranscript version
npx @iankiku/anytranscript@latest --version
```

The second one matters more — it's the path an actual user takes, and it
catches a tarball that published but doesn't run.
