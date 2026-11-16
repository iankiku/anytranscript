/**
 * Excel workbooks (.xlsx), which Google Sheets, Numbers and LibreOffice open
 * too. Cells are written as inline strings and plain numbers, never formulas,
 * so text from a transcript or a title can't run as one.
 */

import { formatTimestamp } from "./format.js";
import type { Transcript } from "./types.js";
import { zip } from "./zip.js";

export type Cell = string | number | null | undefined;

export interface Sheet {
  /** Tab name: at most 31 characters, none of `[]:*?/\`. */
  name: string;
  /** Column widths in characters, left to right. */
  widths?: number[];
  /** Column indexes (0-based) whose text should wrap. */
  wrap?: number[];
  /** First row is the header: bold and frozen in place. */
  rows: Cell[][];
}

/** Excel refuses longer cells. */
const MAX_CELL = 32_767;

function escapeXml(text: string): string {
  return text
    // XML 1.0 forbids most control characters, and Excel won't open a file containing them.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 0 → A, 25 → Z, 26 → AA. */
function column(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

const STYLE = { normal: 0, header: 1, wrap: 2 } as const;

function cellXml(value: Cell, ref: string, style: number): string {
  const s = style ? ` s="${style}"` : "";
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : "";
  }
  const text = escapeXml(value.length > MAX_CELL ? value.slice(0, MAX_CELL) : value);
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function sheetXml({ widths = [], wrap = [], rows }: Sheet): string {
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const style = r === 0 ? STYLE.header : wrap.includes(c) ? STYLE.wrap : STYLE.normal;
          return cellXml(value, `${column(c)}${r + 1}`, style);
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/** Build an .xlsx workbook with one tab per sheet. */
export function buildWorkbook(sheets: Sheet[]): Buffer {
  const names = sheets.map((sheet, i) => {
    const clean = sheet.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim();
    return clean || `Sheet${i + 1}`;
  });
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    `</sheets></workbook>`;
  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    `</Types>`;
  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  return zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
    { name: "xl/styles.xml", data: STYLES },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheet) })),
  ]);
}

/**
 * A transcript as a workbook: a "Transcript" tab with one row per segment
 * (start and end in seconds, a readable timestamp, the text) and a "Video"
 * tab with the title, link, channel, duration and where the text came from.
 */
export function transcriptToXlsx(transcript: Transcript): Buffer {
  const { info } = transcript;
  const segments = transcript.segments.length
    ? transcript.segments
    : [{ start: 0, end: info.duration ?? 0, text: transcript.text }];
  return buildWorkbook([
    {
      name: "Transcript",
      widths: [10, 10, 14, 100],
      wrap: [3],
      rows: [
        ["Start (s)", "End (s)", "Timestamp", "Text"],
        ...segments.map((s) => [
          Math.round(s.start * 1000) / 1000,
          Math.round(s.end * 1000) / 1000,
          formatTimestamp(s.start, "vtt"),
          s.text,
        ]),
      ],
    },
    {
      name: "Video",
      widths: [14, 80],
      wrap: [1],
      rows: [
        ["Field", "Value"],
        ["Title", info.title],
        ["URL", info.webpageUrl],
        ["Channel", info.uploader],
        ["Duration (s)", info.duration],
        ["Platform", info.extractor],
        ["Transcript", transcript.source],
        ["Language", transcript.language],
      ],
    },
  ]);
}
