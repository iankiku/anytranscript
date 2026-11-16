import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { transcribeMany, transcriptName } from "../dist/batch.js";
import { CommandError } from "../dist/proc.js";

let root;
before(async () => (root = await mkdtemp(join(tmpdir(), "anytranscript-batch-"))));
after(async () => rm(root, { recursive: true, force: true }));

const fakeTranscript = (url) => {
  const id = new URL(url).searchParams.get("v") ?? "x";
  return {
    text: `words from ${id}`,
    source: "captions",
    language: "en",
    segments: [{ start: 0, end: 1.5, text: `words from ${id}` }],
    info: { id, title: `Video ${id}`, uploader: "someone", duration: 2, webpageUrl: url, extractor: "Youtube" },
  };
};

/** A transcriber that records calls and fails the way real sites do. */
function fakeSite() {
  const calls = [];
  let flaky = 0;
  return {
    calls,
    transcriber: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("v=dead")) throw new CommandError("yt-dlp", 1, "ERROR: [youtube] dead: Video unavailable\n");
      if (url.includes("v=flaky") && flaky++ === 0) {
        throw new CommandError("yt-dlp", 1, "ERROR: Unable to download webpage: HTTP Error 503: Service Unavailable\n");
      }
      return fakeTranscript(url);
    },
  };
}

const URLS = [
  "https://www.youtube.com/watch?v=aaa",
  "https://www.youtube.com/watch?v=flaky",
  "https://www.youtube.com/watch?v=dead",
  "https://www.youtube.com/watch?v=aaa", // duplicate, done once
];
const FAST = { delaySeconds: 0, retryDelayMs: 5 };

test("writes one file per video, an index, a manifest and a list of failures", async () => {
  const outDir = join(root, "run1");
  const site = fakeSite();
  const events = [];
  const result = await transcribeMany(URLS, {
    outDir,
    format: "md",
    ...FAST,
    transcriber: site.transcriber,
    onEvent: (e) => events.push(e.type),
  });

  assert.deepEqual(result.items.map((i) => i.status), ["ok", "ok", "failed"]);
  assert.equal(result.items[1].attempts, 2, "the 503 was retried");
  assert.equal(result.items[2].attempts, 1, "the dead video was not retried");
  assert.equal(result.items[2].error, "ERROR: [youtube] dead: Video unavailable");

  const files = (await readdir(outDir)).sort();
  assert.deepEqual(files, ["failed.txt", "index.csv", "manifest.jsonl", "video-aaa-aaa.md", "video-flaky-flaky.md"]);
  assert.match(await readFile(join(outDir, "video-aaa-aaa.md"), "utf8"), /^# Video aaa/);
  assert.equal(await readFile(result.failedFile, "utf8"), "https://www.youtube.com/watch?v=dead\n");

  const index = (await readFile(result.indexFile, "utf8")).trim().split("\n");
  assert.equal(index[0], "url,status,title,uploader,duration,source,language,file,attempts,error");
  assert.equal(index[1], "https://www.youtube.com/watch?v=aaa,ok,Video aaa,someone,2,captions,en,video-aaa-aaa.md,1,");
  assert.match(index[3], /^https:\/\/www\.youtube\.com\/watch\?v=dead,failed,,,,,,,1,ERROR: \[youtube\] dead: Video unavailable$/);

  assert.equal(events[0], "plan");
  assert.equal(events.filter((e) => e === "done").length, 3);
});

test("passes timeouts, a cancel signal and a per-job workdir to each transcription", async () => {
  const site = fakeSite();
  await transcribeMany(["https://www.youtube.com/watch?v=aaa"], {
    outDir: join(root, "opts"),
    workdir: join(root, "media"),
    lang: "de",
    timeoutMinutes: 2,
    ...FAST,
    transcriber: site.transcriber,
  });
  const { options } = site.calls[0];
  assert.equal(options.lang, "de");
  assert.equal(options.timeoutMs, 120_000);
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.workdir, join(root, "media", "1"), "jobs must not share a media folder");
  assert.equal(options.outDir, undefined, "batch-only options are not passed through");
});

test("a re-run skips finished videos and retries only the failures", async () => {
  const outDir = join(root, "resume");
  await transcribeMany(URLS, { outDir, ...FAST, transcriber: fakeSite().transcriber });

  const site = fakeSite();
  const result = await transcribeMany(URLS, { outDir, ...FAST, transcriber: site.transcriber });
  assert.deepEqual(site.calls.map((c) => c.url), ["https://www.youtube.com/watch?v=dead"]);
  assert.deepEqual(result.items.map((i) => i.status), ["skipped", "skipped", "failed"]);
  assert.equal(result.items[0].title, "Video aaa", "skipped rows keep their details in the index");
  assert.ok(result.items[0].file.endsWith("video-aaa-aaa.txt"));
});

test("a different format, --force, or a deleted file means the video runs again", async () => {
  const outDir = join(root, "redo");
  const one = ["https://www.youtube.com/watch?v=aaa"];
  await transcribeMany(one, { outDir, ...FAST, transcriber: fakeSite().transcriber });

  let site = fakeSite();
  await transcribeMany(one, { outDir, format: "csv", ...FAST, transcriber: site.transcriber });
  assert.equal(site.calls.length, 1, "csv was never written, so it is not done");

  site = fakeSite();
  await transcribeMany(one, { outDir, format: "csv", force: true, ...FAST, transcriber: site.transcriber });
  assert.equal(site.calls.length, 1);

  await rm(join(outDir, "video-aaa-aaa.csv"));
  site = fakeSite();
  await transcribeMany(one, { outDir, format: "csv", ...FAST, transcriber: site.transcriber });
  assert.equal(site.calls.length, 1, "a missing file is not counted as done");
});

test("failed.txt goes away once the folder has no failures left", async () => {
  const outDir = join(root, "clean");
  const dead = "https://www.youtube.com/watch?v=dead";
  await transcribeMany([dead], { outDir, ...FAST, transcriber: fakeSite().transcriber });
  assert.ok(existsSync(join(outDir, "failed.txt")));

  const other = await transcribeMany(["https://www.youtube.com/watch?v=aaa"], { outDir, ...FAST, transcriber: fakeSite().transcriber });
  assert.ok(other.failedFile, "an earlier failure in this folder is still listed");

  const revived = async (url) => fakeTranscript(url);
  const result = await transcribeMany([dead], { outDir, ...FAST, transcriber: revived });
  assert.equal(result.failedFile, undefined);
  assert.equal(existsSync(join(outDir, "failed.txt")), false);
});

test("an abort keeps finished work, records nothing for unfinished work, and lists it as failed", async () => {
  const outDir = join(root, "abort");
  const controller = new AbortController();
  const transcriber = (url, { signal }) =>
    url.includes("v=aaa")
      ? Promise.resolve(fakeTranscript(url))
      : new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  setTimeout(() => controller.abort(new Error("Ctrl-C")), 50);
  const result = await transcribeMany(
    ["https://www.youtube.com/watch?v=aaa", "https://www.youtube.com/watch?v=slow", "https://x.com/watch?v=queued"],
    { outDir, concurrency: 2, ...FAST, transcriber, signal: controller.signal },
  );
  assert.deepEqual(result.items.map((i) => i.status), ["ok", "interrupted", "interrupted"]);
  const manifest = (await readFile(join(outDir, "manifest.jsonl"), "utf8")).trim().split("\n");
  assert.equal(manifest.length, 1, "only the finished video is recorded");
  assert.equal(
    await readFile(result.failedFile, "utf8"),
    "https://www.youtube.com/watch?v=slow\nhttps://x.com/watch?v=queued\n",
  );
});

test("a manifest line cut short by a crash is ignored, not fatal", async () => {
  const outDir = join(root, "torn");
  const one = ["https://www.youtube.com/watch?v=aaa"];
  await transcribeMany(one, { outDir, ...FAST, transcriber: fakeSite().transcriber });
  const { appendFile } = await import("node:fs/promises");
  await appendFile(join(outDir, "manifest.jsonl"), '{"url":"https://www.youtube.com/wat');
  const site = fakeSite();
  const result = await transcribeMany(one, { outDir, ...FAST, transcriber: site.transcriber });
  assert.equal(site.calls.length, 0);
  assert.equal(result.items[0].status, "skipped");
});

test("transcriptName is filesystem-safe and stable", () => {
  const t = (title, id) => ({ info: { title, id } });
  assert.equal(transcriptName(t("Me at the zoo", "jNQXAC9IVRw"), "u"), "me-at-the-zoo-jNQXAC9IVRw");
  assert.equal(transcriptName(t("Café: ¿Qué tal? / 2024", "a/b"), "u"), "cafe-que-tal-2024-ab");
  assert.equal(transcriptName(t("日本語", "xyz"), "u"), "xyz");
  assert.match(transcriptName(t("Title", "unknown"), "https://a.com/1"), /^title-[0-9a-f]{10}$/);
  assert.ok(transcriptName(t("a".repeat(200), "id"), "u").length <= 63);
});

test("a record written after a torn last line survives", async () => {
  const outDir = join(root, "torn-tail");
  const { appendFile } = await import("node:fs/promises");
  await transcribeMany(["https://www.youtube.com/watch?v=aaa"], { outDir, ...FAST, transcriber: fakeSite().transcriber });
  await appendFile(join(outDir, "manifest.jsonl"), '{"url":"https://cut-off');
  await transcribeMany(["https://www.youtube.com/watch?v=flaky"], { outDir, ...FAST, transcriber: fakeSite().transcriber });

  const site = fakeSite();
  await transcribeMany(["https://www.youtube.com/watch?v=flaky"], { outDir, ...FAST, transcriber: site.transcriber });
  assert.equal(site.calls.length, 0, "the video finished after the torn line must count as done");
});

test("re-running only the failures keeps the whole folder in index.csv and failed.txt", async () => {
  const outDir = join(root, "rerun-failed");
  await transcribeMany(URLS, { outDir, ...FAST, transcriber: fakeSite().transcriber });
  const result = await transcribeMany(["https://www.youtube.com/watch?v=dead"], { outDir, ...FAST, transcriber: fakeSite().transcriber });

  assert.equal(result.items.length, 1, "items are this run's URLs only");
  const index = (await readFile(result.indexFile, "utf8")).trim().split("\n").slice(1);
  assert.deepEqual(index.map((row) => row.split(",").slice(0, 2).join(",")).sort(), [
    "https://www.youtube.com/watch?v=aaa,ok",
    "https://www.youtube.com/watch?v=dead,failed",
    "https://www.youtube.com/watch?v=flaky,ok",
  ]);
  assert.equal(await readFile(result.failedFile, "utf8"), "https://www.youtube.com/watch?v=dead\n");
});

test("the same video under two URLs is written once each without a clash", async () => {
  const outDir = join(root, "two-urls");
  const result = await transcribeMany(
    ["https://www.youtube.com/watch?v=aaa", "https://youtu.be/x?v=aaa"],
    { outDir, concurrency: 2, ...FAST, transcriber: fakeSite().transcriber },
  );
  assert.deepEqual(result.items.map((i) => i.status), ["ok", "ok"]);
  assert.deepEqual((await readdir(outDir)).filter((f) => f.endsWith(".part")), []);
});

test("changing --timestamps redoes the video instead of skipping it", async () => {
  const outDir = join(root, "variant");
  const one = ["https://www.youtube.com/watch?v=aaa"];
  await transcribeMany(one, { outDir, ...FAST, transcriber: fakeSite().transcriber });
  const site = fakeSite();
  await transcribeMany(one, { outDir, formatOptions: { timestamps: true }, ...FAST, transcriber: site.transcriber });
  assert.equal(site.calls.length, 1);
  assert.equal(await readFile(join(outDir, "video-aaa-aaa.txt"), "utf8"), "[00:00] words from aaa\n");
});
