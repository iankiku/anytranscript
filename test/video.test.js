import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const CLI = new URL("../dist/cli.js", import.meta.url).pathname;
const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const URL_ABC = "https://www.youtube.com/watch?v=abc";

let dir;
let env;
before(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "ant-video-")));
  await writeFile(join(dir, "My Clip.mov"), "media");
  await writeFile(join(dir, "audioonly.m4a"), "media");
  env = {
    ...process.env,
    HOME: dir,
    XDG_CACHE_HOME: join(dir, "cache"),
    ANYTRANSCRIPT_YTDLP: fixture("fake-yt-dlp.mjs"),
    ANYTRANSCRIPT_FFMPEG: fixture("fake-ffmpeg.mjs"),
  };
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function ant(args, extraEnv = {}) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [CLI, "video", ...args], { cwd: dir, env: { ...env, ...extraEnv } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

const lines = (stdout) => stdout.trim().split("\n");

test("ant video saves the whole video and prints its path, with no frames unless asked", async () => {
  const { code, stdout, stderr } = await ant([URL_ABC, "-d", "only-video"]);
  assert.equal(code, 0, stderr);
  const video = join(dir, "only-video", "talk-abc-abc.mp4");
  assert.deepEqual(lines(stdout), [video]);
  assert.equal(await readFile(video, "utf8"), "video of abc");
  assert.deepEqual(await readdir(join(dir, "only-video")), ["talk-abc-abc.mp4"]);
});

test("--frames saves a still per scene change and frames.json with each frame's time", async () => {
  const { code, stdout, stderr } = await ant([URL_ABC, "--frames", "-d", "refs"]);
  assert.equal(code, 0, stderr);
  const framesDir = join(dir, "refs", "talk-abc-abc-frames");
  assert.deepEqual(lines(stdout), [join(dir, "refs", "talk-abc-abc.mp4"), framesDir]);
  assert.deepEqual((await readdir(framesDir)).sort(), ["frame-0001.jpg", "frame-0002.jpg", "frame-0003.jpg", "frames.json"]);
  const index = JSON.parse(await readFile(join(framesDir, "frames.json"), "utf8"));
  assert.equal(index.mode, "scene changes");
  assert.deepEqual(index.frames, [
    { file: "frame-0001.jpg", time: 0 },
    { file: "frame-0002.jpg", time: 2.5 },
    { file: "frame-0003.jpg", time: 7 },
  ]);
});

test("--every spaces the stills evenly, --max-frames caps them, and a rerun leaves no stale frames", async () => {
  await ant([URL_ABC, "--frames", "-d", "rerun"]);
  const { code, stderr } = await ant([URL_ABC, "--every", "2", "--max-frames", "2", "-d", "rerun"]);
  assert.equal(code, 0, stderr);
  const framesDir = join(dir, "rerun", "talk-abc-abc-frames");
  assert.deepEqual((await readdir(framesDir)).sort(), ["frame-0001.jpg", "frame-0002.jpg", "frames.json"]);
  const index = JSON.parse(await readFile(join(framesDir, "frames.json"), "utf8"));
  assert.equal(index.mode, "one every 2s");
  assert.equal(index.frames.length, 2);
});

test("a file on this computer gets frames without being copied", async () => {
  const { code, stdout, stderr } = await ant(["My Clip.mov", "--frames", "-d", "local"]);
  assert.equal(code, 0, stderr);
  const [video, framesDir] = lines(stdout);
  assert.equal(video, join(dir, "My Clip.mov"));
  assert.match(framesDir, new RegExp(`^${join(dir, "local")}/my-clip-[0-9a-f]{10}-frames$`));
  assert.deepEqual((await readdir(join(dir, "local"))).length, 1);
});

test("ffmpeg older than 5.1 still saves frames", async () => {
  const { code, stderr } = await ant(["My Clip.mov", "--frames", "-d", "old"], { FAKE_FFMPEG_OLD: "1" });
  assert.equal(code, 0, stderr);
  assert.match(stderr, /saved 3 frames/);
});

test("bad input fails with exit 1 and a reason, before any download", async () => {
  const cases = [
    [["not a link"], /not a valid video URL or file/],
    [[join(dir, "missing.mov")], /there is no file at/],
    [["audioonly.m4a", "--frames"], /has no picture/],
    [[URL_ABC, "--every", "0"], /invalid --every "0"/],
    [[URL_ABC, "--max-frames", "1.5"], /invalid --max-frames "1.5"/],
  ];
  for (const [args, reason] of cases) {
    const { code, stdout, stderr } = await ant(args);
    assert.equal(code, 1, args.join(" "));
    assert.equal(stdout, "");
    assert.match(stderr, reason, args.join(" "));
  }
});

test("with several videos, one failure is reported and the rest are saved", async () => {
  const { code, stdout, stderr } = await ant(["https://www.youtube.com/watch?v=dead", URL_ABC, "-d", "many"]);
  assert.equal(code, 1);
  assert.deepEqual(lines(stdout), [join(dir, "many", "talk-abc-abc.mp4")]);
  assert.match(stderr, /failed: https:\/\/www\.youtube\.com\/watch\?v=dead: [\s\S]*unavailable/i);
});

test("--help documents ant video", async () => {
  const { stdout } = await exec(process.execPath, [CLI, "--help"]);
  assert.match(stdout, /ant video <url\|file>/);
  assert.match(stdout, /--frames/);
  assert.match(stdout, /--max-frames/);
});
