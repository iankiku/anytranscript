import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { run, TimeoutError } from "../dist/proc.js";

test("run kills a step that exceeds its timeout and says so", async () => {
  const started = Date.now();
  await assert.rejects(run("sleep", ["5"], { timeoutMs: 100 }), (error) => {
    assert.ok(error instanceof TimeoutError);
    assert.match(error.message, /^sleep timed out after/);
    return true;
  });
  assert.ok(Date.now() - started < 2000, "the child must be killed, not waited out");
});

test("run stops when the caller aborts, with the caller's reason", async () => {
  const controller = new AbortController();
  const pending = run("sleep", ["5"], { signal: controller.signal });
  setTimeout(() => controller.abort(new Error("user pressed Ctrl-C")), 50);
  await assert.rejects(pending, /user pressed Ctrl-C/);
});

test("run refuses to start once already aborted", async () => {
  await assert.rejects(run("sleep", ["5"], { signal: AbortSignal.abort(new Error("gone")) }), /gone/);
});

test("run still resolves normally within its timeout", async () => {
  const { stdout } = await run("echo", ["hi"], { timeoutMs: 5000 });
  assert.equal(stdout.trim(), "hi");
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("a timeout kills the whole process tree, not just the direct child", { skip: process.platform === "win32" }, async () => {
  // Like yt-dlp starting ffmpeg: the shell starts a grandchild and waits on it.
  const dir = await mkdtemp(join(tmpdir(), "ant-proc-"));
  const pidFile = join(dir, "pid");
  await assert.rejects(run("sh", ["-c", `sleep 30 & echo $! > ${pidFile}; wait`], { timeoutMs: 300 }), TimeoutError);
  const grandchild = Number(await readFile(pidFile, "utf8"));
  await sleep(200);
  assert.equal(alive(grandchild), false, "the grandchild must not outlive the timeout");
  await rm(dir, { recursive: true, force: true });
});
