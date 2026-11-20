import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const json = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));

const parts = (version) => version.split(".").map(Number);
const atLeast = (a, b) => {
  for (let i = 0; i < 3; i++) if (parts(a)[i] !== parts(b)[i]) return parts(a)[i] > parts(b)[i];
  return true;
};

// Between releases the plugin may name the upcoming version; the release
// workflow refuses to publish unless the two match exactly.
test("the plugin runs the package version it was written for", async () => {
  const pkg = await json("package.json");
  const plugin = await json("plugin/.claude-plugin/plugin.json");
  assert.ok(atLeast(plugin.version, pkg.version), `plugin ${plugin.version} is behind package ${pkg.version}`);

  // Anthropic's plugin directory refuses version ranges, so the exact version is pinned.
  const { args } = (await json("plugin/.mcp.json")).mcpServers.anytranscript;
  assert.deepEqual(args, ["-y", `@iankiku/anytranscript@${plugin.version}`, "mcp"]);
});

test("the marketplace lists the plugin from ./plugin", async () => {
  const market = await json(".claude-plugin/marketplace.json");
  assert.deepEqual(market.plugins.map((p) => [p.name, p.source]), [["anytranscript", "./plugin"]]);
});

test("the plugin skill names both tools", async () => {
  const skill = await readFile(new URL("../plugin/skills/anytranscript/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /^---\nname: anytranscript\ndescription: /);
  assert.match(skill, /`transcribe`/);
  assert.match(skill, /`transcribe_many`/);
});
