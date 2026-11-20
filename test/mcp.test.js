import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";

const CLI = new URL("../dist/cli.js", import.meta.url).pathname;
const FAKE_YTDLP = new URL("./fixtures/fake-yt-dlp.mjs", import.meta.url).pathname;

/** A running `ant mcp` server, spoken to over stdio like an MCP client would. */
function startServer(cwd) {
  const child = spawn(process.execPath, [CLI, "mcp"], {
    cwd,
    env: { ...process.env, ANYTRANSCRIPT_YTDLP: FAKE_YTDLP },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiting = new Map();
  const notifications = [];
  const stdoutLines = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    stdoutLines.push(line);
    const message = JSON.parse(line);
    if (message.id !== undefined && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    } else {
      notifications.push(message);
    }
  });
  let nextId = 1;
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params) => {
    const id = nextId++;
    send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
    return new Promise((resolve) => waiting.set(id, resolve));
  };
  const stop = () => new Promise((resolve) => { child.on("close", resolve); child.stdin.end(); });
  return { child, send, request, notifications, stdoutLines, stop };
}

const call = async (server, name, args, meta) => {
  const response = await server.request("tools/call", { name, arguments: args, ...(meta ? { _meta: meta } : {}) });
  assert.equal(response.error, undefined, JSON.stringify(response.error));
  return response.result;
};
const payload = (result) => JSON.parse(result.content[0].text);

let dir;
let server;
before(async () => {
  await chmod(FAKE_YTDLP, 0o755);
  dir = await realpath(await mkdtemp(join(tmpdir(), "ant-mcp-")));
  server = startServer(dir);
});
after(async () => {
  await server.stop();
  await rm(dir, { recursive: true, force: true });
});

test("initialize names the server and offers tools", async () => {
  const { result } = await server.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(result.protocolVersion, "2025-06-18");
  assert.equal(result.serverInfo.name, "anytranscript");
  assert.deepEqual(result.capabilities, { tools: {} });
  assert.match(result.instructions, /transcribe_many/);
});

test("an unknown protocol version gets the newest one this server speaks", async () => {
  const { result } = await server.request("initialize", { protocolVersion: "1999-01-01", capabilities: {} });
  assert.match(result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(result.protocolVersion, "1999-01-01");
});

test("tools/list describes both tools with input schemas", async () => {
  const { result } = await server.request("tools/list");
  const byName = Object.fromEntries(result.tools.map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(byName).sort(), ["transcribe", "transcribe_many"]);
  assert.deepEqual(byName.transcribe.inputSchema.required, ["url"]);
  assert.deepEqual(byName.transcribe_many.inputSchema.required, ["urls"]);
  assert.ok(byName.transcribe.inputSchema.properties.format.enum.includes("xlsx"));
  assert.ok(byName.transcribe.annotations.readOnlyHint === false);
});

test("transcribe saves a Markdown document by default and returns a link to it", async () => {
  const data = payload(await call(server, "transcribe", { url: "https://www.youtube.com/watch?v=abc" }));
  assert.equal(data.title, "Talk abc");
  assert.equal(data.source, "captions");
  assert.equal(data.file, join(dir, "transcripts", "talk-abc-abc.md"));
  assert.equal(data.link, `[Talk abc](${data.file})`);
  assert.match(await readFile(data.file, "utf8"), /^# Talk abc/);
  assert.equal(data.transcript, "[00:01] hello from abc\n[01:05] the end");
});

test("transcribe with save: false writes no file", async () => {
  const data = payload(await call(server, "transcribe", { url: "https://www.youtube.com/watch?v=nofile", save: false }));
  assert.equal(data.file, null);
  assert.equal(data.link, null);
  await assert.rejects(readFile(join(dir, "transcripts", "talk-nofile-nofile.md")));
});

test("markdown links survive spaces and brackets", async () => {
  const { markdownLink } = await import("../dist/mcp.js");
  assert.equal(markdownLink("A [draft] talk", "/a/b.md"), "[A \\[draft\\] talk](/a/b.md)");
  assert.equal(markdownLink("Talk", "/My Notes/t (1).md"), "[Talk](</My Notes/t (1).md>)");
});

test("transcribe saves a file when asked and returns its full path", async () => {
  const data = payload(
    await call(server, "transcribe", { url: "https://www.youtube.com/watch?v=abc", format: "md", includeTranscript: false }),
  );
  assert.equal(data.file, join(dir, "transcripts", "talk-abc-abc.md"));
  assert.equal(data.transcript, undefined);
  assert.match(await readFile(data.file, "utf8"), /^# Talk abc/);

  const xlsx = payload(await call(server, "transcribe", { url: "https://www.youtube.com/watch?v=abc", saveAs: "out/talk.xlsx" }));
  assert.equal(xlsx.file, join(dir, "out", "talk.xlsx"));
  assert.equal((await readFile(xlsx.file)).subarray(0, 2).toString(), "PK");
});

test("a failed transcription is a tool error with the reason, not a protocol error", async () => {
  const result = await call(server, "transcribe", { url: "https://www.youtube.com/watch?v=dead" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Video unavailable/);
});

test("bad arguments are reported back to the agent", async () => {
  const missing = await call(server, "transcribe", {});
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /url is required/);
  const wrong = await call(server, "transcribe", { url: "https://a.com/v", format: "docx" });
  assert.match(wrong.content[0].text, /format must be one of/);
});

test("transcribe_many writes a folder of files and reports where everything is", async () => {
  const urls = ["https://www.youtube.com/watch?v=one", "https://www.youtube.com/watch?v=dead"];
  const data = payload(
    await call(server, "transcribe_many", { urls, format: "csv", outDir: "batch", delaySeconds: 0 }, { progressToken: "p1" }),
  );
  assert.equal(data.outDir, join(dir, "batch"));
  assert.equal(data.index, join(dir, "batch", "index.csv"));
  assert.equal(data.failedList, join(dir, "batch", "failed.txt"));
  assert.deepEqual([data.done, data.alreadyDone, data.failed], [1, 0, 1]);
  assert.equal(data.items[0].file, join(dir, "batch", "talk-one-one.csv"));
  assert.match(data.items[1].error, /Video unavailable/);

  const progress = server.notifications.filter((n) => n.method === "notifications/progress" && n.params.progressToken === "p1");
  assert.equal(progress.length, 2);
  assert.deepEqual(progress.map((p) => p.params.total), [2, 2]);
});

test("unknown methods get a JSON-RPC error; pings get an answer; stdout carries only JSON-RPC", async () => {
  const unknown = await server.request("resources/list");
  assert.equal(unknown.error.code, -32601);
  const pong = await server.request("ping");
  assert.deepEqual(pong.result, {});
  for (const line of server.stdoutLines) assert.equal(JSON.parse(line).jsonrpc, "2.0");
});
