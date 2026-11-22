import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("bulk mode refuses single-file flags and bad numbers before doing any work", async () => {
  await assert.rejects(main(["https://a.com/1", "https://a.com/2", "-o", "x.txt"]), /-o writes a single file/);
  await assert.rejects(main(["https://a.com/1", "https://a.com/2", "--json", "x.json"]), /use -f json/);
  await assert.rejects(main(["https://a.com/1", "https://a.com/2", "-j", "0"]), /invalid --jobs "0"/);
  await assert.rejects(main(["https://a.com/1", "https://a.com/2", "--retries", "1.5"]), /invalid --retries/);
  const dir = await mkdtemp(join(tmpdir(), "ant-cli-"));
  const empty = join(dir, "empty.txt");
  await writeFile(empty, "# nothing here\n");
  await assert.rejects(main(["-i", empty]), /no URLs found/);
  await rm(dir, { recursive: true, force: true });
});

const FAKE_YTDLP = new URL("./fixtures/fake-yt-dlp.mjs", import.meta.url).pathname;

async function ant(args, cwd) {
  await chmod(FAKE_YTDLP, 0o755);
  const env = { ...process.env, ANYTRANSCRIPT_YTDLP: FAKE_YTDLP };
  try {
    const { stdout, stderr } = await exec(process.execPath, [CLI, ...args], { cwd, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("end to end: a single URL with timestamps", async () => {
  const { code, stdout } = await ant(["https://www.youtube.com/watch?v=abc", "-t", "-q"]);
  assert.equal(code, 0);
  assert.equal(stdout, "[00:01] hello from abc\n[01:05] the end\n");
});

test("end to end: a quoted url= argument still works", async () => {
  const { code, stdout } = await ant(['url=https://www.youtube.com/watch?v=abc ', "-t", "-q"]);
  assert.equal(code, 0);
  assert.equal(stdout, "[00:01] hello from abc\n[01:05] the end\n");
});

test("end to end: a non-link fails with exit 1 and a clear message", async () => {
  const { code, stdout, stderr } = await ant(["not a link"]);
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /not a valid video URL or file: "not a link" \(it contains spaces/);
  assert.doesNotMatch(stderr, /yt-dlp/);
});

test("end to end: -o and --json create missing folders", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ant-out-"));
  const { code, stderr } = await ant(
    ["https://www.youtube.com/watch?v=abc", "-o", "new/notes/talk.md", "--json", "data/segments.json"],
    dir,
  );
  assert.equal(code, 0, stderr);
  assert.match(await readFile(join(dir, "new", "notes", "talk.md"), "utf8"), /hello from abc/);
  assert.equal(JSON.parse(await readFile(join(dir, "data", "segments.json"), "utf8")).length, 2);
  await rm(dir, { recursive: true, force: true });
});

test("end to end: -o reports the full path of the saved file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ant-out-"));
  const { code, stderr } = await ant(["https://www.youtube.com/watch?v=abc", "-o", "notes.md"], dir);
  assert.equal(code, 0);
  assert.ok(stderr.includes(`wrote md transcript to ${join(await realpath(dir), "notes.md")}\n`), stderr);
  await rm(dir, { recursive: true, force: true });
});

test("end to end: a bulk run from a file, then a resumed re-run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ant-bulk-"));
  await writeFile(
    join(dir, "urls.txt"),
    "# talks\nhttps://www.youtube.com/watch?v=one\nhttps://www.youtube.com/watch?v=dead\nhttps://youtu.be/x?v=two  second\n",
  );

  const first = await ant(["-i", "urls.txt", "-f", "md", "-d", "out", "--delay", "0"], dir);
  const out = join(await realpath(dir), "out");
  assert.equal(first.code, 1, "one video failed, so the run is not a success");
  assert.equal(first.stdout, `${out}/talk-one-one.md\n${out}/talk-two-two.md\n`, "full paths, so they open from anywhere");
  assert.match(first.stderr, /\[2\/3\] failed: ERROR: \[youtube\] dead: Video unavailable\n/);
  assert.ok(first.stderr.includes(`2 done, 1 failed. Summary: ${out}/index.csv`));
  assert.ok(first.stderr.includes(`re-run what's left with: ant -i ${out}/failed.txt -d out -f md`));
  assert.match(await readFile(join(dir, "out", "talk-one-one.md"), "utf8"), /\*\*\[01:05\]\(https:\/\/youtu\.be\/one\?t=65\)\*\* the end/);
  assert.equal(await readFile(join(dir, "out", "failed.txt"), "utf8"), "https://www.youtube.com/watch?v=dead\n");

  const again = await ant(["-i", "urls.txt", "-f", "md", "-d", "out", "--delay", "0"], dir);
  assert.match(again.stderr, /3 videos: 1 to do, 2 already done in out/);
  assert.equal(again.stdout, first.stdout, "skipped videos are still listed");
  await rm(dir, { recursive: true, force: true });
});

test("end to end: -o picks xlsx from the extension and writes a workbook", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ant-xlsx-"));
  const { code } = await ant(["https://www.youtube.com/watch?v=abc", "-q", "-o", "talk.xlsx"], dir);
  assert.equal(code, 0);
  const head = (await readFile(join(dir, "talk.xlsx"))).subarray(0, 2).toString();
  assert.equal(head, "PK");
  await rm(dir, { recursive: true, force: true });
});
