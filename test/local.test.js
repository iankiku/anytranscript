import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { looksLikeFile, parseDuration } from "../dist/local.js";

const exec = promisify(execFile);
const CLI = new URL("../dist/cli.js", import.meta.url).pathname;
const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

let dir;
let env;
before(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "ant-local-")));
  // A cached model, so nothing is downloaded.
  await mkdir(join(dir, "cache", "anytranscript", "models"), { recursive: true });
  await writeFile(join(dir, "cache", "anytranscript", "models", "ggml-small.bin"), "fake model");
  for (const name of ["My Clip.mov", "clip.m4a", "b.mp3", "silent.mov"]) await writeFile(join(dir, name), "media");
  await writeFile(join(dir, "empty.mov"), "");
  await mkdir(join(dir, "folder"));
  env = {
    ...process.env,
    HOME: dir,
    XDG_CACHE_HOME: join(dir, "cache"),
    ANYTRANSCRIPT_FFMPEG: fixture("fake-ffmpeg.mjs"),
    ANYTRANSCRIPT_WHISPER: fixture("fake-whisper.mjs"),
    // A file must never reach yt-dlp; this path would fail if it did.
    ANYTRANSCRIPT_YTDLP: join(dir, "no-yt-dlp"),
    OPENAI_API_KEY: "",
    GROQ_API_KEY: "",
  };
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function ant(args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [CLI, ...args], { cwd: dir, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

const EXPECTED = "[00:01] hello from a 16k wav\n[00:15] the end\n";

test("a file path with a space is transcribed through ffmpeg and whisper.cpp", async () => {
  const { code, stdout, stderr } = await ant([join(dir, "My Clip.mov"), "-t", "-q"]);
  assert.equal(code, 0, stderr);
  assert.equal(stdout, EXPECTED);
});

test("relative, ~, quoted, file:// and drag-and-drop paths all work", async () => {
  for (const input of [
    "clip.m4a",
    "./clip.m4a",
    "~/clip.m4a",
    `"${join(dir, "clip.m4a")}"`,
    pathToFileURL(join(dir, "My Clip.mov")).href,
    join(dir, "My\\ Clip.mov"),
  ]) {
    const { code, stdout, stderr } = await ant([input, "-t", "-q"]);
    assert.equal(code, 0, `${input}: ${stderr}`);
    assert.equal(stdout, EXPECTED, input);
  }
});

test("the Markdown file names the file, its length and a link back to it", async () => {
  const { code, stderr } = await ant(["My Clip.mov", "-o", "notes.md"]);
  assert.equal(code, 0, stderr);
  const md = await readFile(join(dir, "notes.md"), "utf8");
  assert.match(md, /^# My Clip\n/);
  assert.ok(md.includes(`- **Source:** <${pathToFileURL(join(dir, "My Clip.mov")).href}>`), md);
  assert.match(md, /- \*\*Duration:\*\* 00:19/);
  assert.match(md, /- \*\*Transcript:\*\* whisper, en/);
});

test("bad paths fail with exit 1 and a reason, before any work", async () => {
  const cases = [
    [join(dir, "missing.mov"), /there is no file at/],
    ["./folder", /it is a folder/],
    ["empty.mov", /the file is empty/],
  ];
  for (const [input, reason] of cases) {
    const { code, stdout, stderr } = await ant([input]);
    assert.equal(code, 1, input);
    assert.equal(stdout, "");
    assert.match(stderr, /not a valid video URL or file/);
    assert.match(stderr, reason, input);
  }
});

test("a file this program can't read stops before any work, with how to fix it", async (t) => {
  if (process.getuid?.() === 0) return t.skip("root reads everything");
  const locked = join(dir, "locked.mov");
  await writeFile(locked, "media");
  await chmod(locked, 0o000);
  const { code, stderr } = await ant([locked]);
  await chmod(locked, 0o644);
  assert.equal(code, 1);
  assert.match(stderr, new RegExp(`can't read ${locked}: `));
  assert.match(stderr, process.platform === "darwin" ? /Privacy & Security > Files and Folders/ : /permission to read/);
  assert.doesNotMatch(stderr, /ffmpeg exited/);
});

test("a file with no audio track says so", async () => {
  const { code, stderr } = await ant(["silent.mov"]);
  assert.equal(code, 1);
  assert.match(stderr, /silent\.mov has no audio track/);
});

test("--captions-only explains that a file has no captions", async () => {
  const { code, stderr } = await ant(["clip.m4a", "--captions-only"]);
  assert.equal(code, 2);
  assert.match(stderr, /no captions available .* has no platform captions/);
});

test("bulk mode takes files too", async () => {
  const { code, stdout, stderr } = await ant(["clip.m4a", "b.mp3", "-d", "out", "-f", "md"]);
  assert.equal(code, 0, stderr);
  const files = (await readdir(join(dir, "out"))).filter((name) => name.endsWith(".md")).sort();
  assert.equal(files.length, 2, stdout);
  assert.match(files[0], /^b-[0-9a-f]{10}\.md$/);
  assert.match(files[1], /^clip-[0-9a-f]{10}\.md$/);
});

test("the MCP transcribe tool takes a file path and saves a Markdown document", async () => {
  const child = spawn(process.execPath, [CLI, "mcp"], { cwd: dir, env, stdio: ["pipe", "pipe", "ignore"] });
  const replies = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id !== undefined) replies.get(message.id)?.(message);
  });
  const request = (id, method, params) =>
    new Promise((resolve) => {
      replies.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  await request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  const response = await request(2, "tools/call", { name: "transcribe", arguments: { url: "My Clip.mov" } });
  child.stdin.end();
  await new Promise((resolve) => child.on("close", resolve));

  assert.equal(response.result.isError, undefined, JSON.stringify(response.result));
  const result = JSON.parse(response.result.content[0].text);
  assert.match(result.file, new RegExp(`^${dir}/transcripts/my-clip-[0-9a-f]{10}\\.md$`));
  assert.match(result.transcript, /hello from a 16k wav/);
  assert.match(await readFile(result.file, "utf8"), /^# My Clip\n/);
});

test("looksLikeFile tells paths from links", () => {
  for (const input of ["/x.mov", "./x.mov", "../x", "~/x.m4a", "file:///x.mov", "C:\\clips\\x.mp4"]) {
    assert.equal(looksLikeFile(input), true, input);
  }
  for (const input of ["https://youtu.be/abc", "youtube.com/watch?v=abc", "hello", ""]) {
    assert.equal(looksLikeFile(input), false, input);
  }
});

test("parseDuration reads ffmpeg's Duration line", () => {
  assert.equal(parseDuration("  Duration: 01:02:03.50, start: 0"), 3723.5);
  assert.equal(parseDuration("no duration here"), null);
});
