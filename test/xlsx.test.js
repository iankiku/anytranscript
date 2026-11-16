import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { renderTranscript } from "../dist/format.js";
import { buildWorkbook, transcriptToXlsx } from "../dist/xlsx.js";
import { crc32, zip } from "../dist/zip.js";

/** Read a zip back by walking its central directory, checking every CRC. */
function unzip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50, "central directory header");
    const crc = buffer.readUInt32LE(at + 16);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    assert.equal(buffer.readUInt32LE(local), 0x04034b50, `local header for ${name}`);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = inflateRawSync(buffer.subarray(start, start + size));
    assert.equal(crc32(data), crc, `crc for ${name}`);
    files[name] = data.toString("utf8");
    at += 46 + nameLength;
  }
  return files;
}

const transcript = {
  text: "=SUM(A1) & <b>bold</b>",
  source: "captions",
  language: "en",
  segments: [
    { start: 1.2, end: 3.36, text: "=SUM(A1) & <b>bold</b>" },
    { start: 65, end: 68, text: "bell \u0007 gone" },
  ],
  info: { id: "abc", title: "Café talk", uploader: null, duration: 70, webpageUrl: "https://youtu.be/abc", extractor: "Youtube" },
};

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("zip round-trips names and contents", () => {
  const files = unzip(zip([{ name: "a.txt", data: "hello" }, { name: "dir/ü.xml", data: Buffer.from("<x/>") }]));
  assert.deepEqual(files, { "a.txt": "hello", "dir/ü.xml": "<x/>" });
});

test("an xlsx has the parts Excel needs, with a Transcript and a Video tab", () => {
  const files = unzip(transcriptToXlsx(transcript));
  assert.deepEqual(Object.keys(files).sort(), [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/workbook.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
  ]);
  assert.match(files["xl/workbook.xml"], /<sheet name="Transcript" sheetId="1" r:id="rId1"\/><sheet name="Video"/);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Start \(s\)<\/t>/, "bold header");
  assert.match(sheet, /<c r="A2"><v>1.2<\/v><\/c><c r="B2"><v>3.36<\/v><\/c>/, "times are numbers");
  assert.match(sheet, /<c r="C3" t="inlineStr"><is><t xml:space="preserve">00:01:05.000<\/t>/);
  assert.match(sheet, /state="frozen"/);
});

test("transcript text is escaped, stays text not formula, and loses characters XML forbids", () => {
  const sheet = unzip(transcriptToXlsx(transcript))["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /t="inlineStr"><is><t xml:space="preserve">=SUM\(A1\) &amp; &lt;b&gt;bold&lt;\/b&gt;<\/t>/);
  assert.doesNotMatch(sheet, /<f>/, "no formula cells, ever");
  assert.match(sheet, /bell  gone/);
  assert.doesNotMatch(sheet, /\u0007/);
});

test("the Video tab skips empty values and keeps unicode", () => {
  const video = unzip(transcriptToXlsx(transcript))["xl/worksheets/sheet2.xml"];
  assert.match(video, /Café talk/);
  assert.match(video, /<row r="4"><c r="A4" t="inlineStr"><is><t xml:space="preserve">Channel<\/t><\/is><\/c><\/row>/);
});

test("buildWorkbook names columns past Z and cleans tab names", () => {
  const row = Array.from({ length: 28 }, (_, i) => i);
  const files = unzip(buildWorkbook([{ name: "a/b:c*d?e[f]g with a very long tab name indeed", rows: [row] }]));
  assert.match(files["xl/worksheets/sheet1.xml"], /<c r="AB1" s="1"><v>27<\/v><\/c>/);
  assert.match(files["xl/workbook.xml"], /<sheet name="a b c d e f g with a very long" /);
});

test("renderTranscript returns a Buffer for xlsx and text otherwise", () => {
  assert.ok(Buffer.isBuffer(renderTranscript(transcript, "xlsx")));
  assert.equal(typeof renderTranscript(transcript, "md"), "string");
});
