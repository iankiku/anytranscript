import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ensureDownloaded, IntegrityError } from "../dist/cache.js";

const PAYLOAD = Buffer.from("the bytes an upstream would serve");
const REAL_SHA = createHash("sha256").update(PAYLOAD).digest("hex");
const WRONG_SHA = "0".repeat(64);

let server;
let origin;
let dir;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/artifact.bin") return void res.end(PAYLOAD);
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}/artifact.bin`;
  dir = await mkdtemp(join(tmpdir(), "anytranscript-test-"));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

test("a download matching its checksum lands in place", async () => {
  const dest = join(dir, "good.bin");
  await ensureDownloaded(origin, dest, { sha256: REAL_SHA });
  assert.ok(existsSync(dest));
});

test("accepts an uppercase checksum", async () => {
  const dest = join(dir, "upper.bin");
  await ensureDownloaded(origin, dest, { sha256: REAL_SHA.toUpperCase() });
  assert.ok(existsSync(dest));
});

test("a checksum mismatch is rejected and leaves nothing behind", async () => {
  const dest = join(dir, "bad.bin");
  await assert.rejects(
    () => ensureDownloaded(origin, dest, { sha256: WRONG_SHA, label: "test artifact" }),
    IntegrityError,
  );
  assert.equal(existsSync(dest), false, "the rejected file must not be left in place");
  assert.equal(existsSync(`${dest}.part`), false, "the partial file must be cleaned up");
});

test("no checksum still downloads — verification is opt-in per artifact", async () => {
  const dest = join(dir, "unverified.bin");
  await ensureDownloaded(origin, dest);
  assert.ok(existsSync(dest));
});

test("an already-cached file is not re-fetched", async () => {
  const dest = join(dir, "cached.bin");
  await ensureDownloaded(origin, dest, { sha256: REAL_SHA });
  // A wrong checksum would throw if this re-downloaded rather than short-circuiting.
  await ensureDownloaded(origin, dest, { sha256: WRONG_SHA });
  assert.ok(existsSync(dest));
});

test("an HTTP error surfaces as a plain failure, not an integrity failure", async () => {
  const dest = join(dir, "missing.bin");
  await assert.rejects(
    () => ensureDownloaded(origin.replace("artifact.bin", "missing.bin"), dest, { sha256: REAL_SHA }),
    (error) => error instanceof Error && !(error instanceof IntegrityError) && /HTTP 404/.test(error.message),
  );
  assert.equal(existsSync(dest), false);
});
