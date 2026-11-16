import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { main } from "../dist/cli.js";

const exec = promisify(execFile);
const CLI = new URL("../dist/cli.js", import.meta.url).pathname;

test("an unknown --format is rejected before any network call", async () => {
  await assert.rejects(main(["https://example.com/v", "-f", "docx"]), /invalid --format "docx"/);
});

test("both ant and anytranscript are installed as commands", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.bin.ant, "dist/cli.js");
  assert.equal(pkg.bin.anytranscript, "dist/cli.js");
});

test("--help documents the short command and every format", async () => {
  const { stdout } = await exec(process.execPath, [CLI, "--help"]);
  assert.match(stdout, /ant <url>/);
  for (const format of ["txt", "md", "csv", "json", "srt", "vtt"]) assert.match(stdout, new RegExp(`\\b${format}\\b`));
});
