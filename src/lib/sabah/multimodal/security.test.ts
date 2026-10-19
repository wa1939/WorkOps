import { describe, expect, it } from "vitest";
import { inspectAsset } from "./security";

const pdf = (body = "1 0 obj << /Type /Catalog >>") => new TextEncoder().encode(`%PDF-1.7\n${body}`);
const png = (width = 100, height = 80) => new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
  (width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255,
  (height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255,
  8, 2, 0, 0, 0,
]);

const base = (bytes: Uint8Array, filename: string, mimeType: string) => ({ bytes, filename, mimeType });

describe("inspectAsset", () => {
  it("accepts a bounded PDF when its signature, MIME, extension, and page metadata agree", () => {
    expect(inspectAsset({ ...base(pdf(), "brief.pdf", "application/pdf"), pageCount: 1 })).toEqual({ ok: true, kind: "pdf", byteCount: pdf().byteLength });
  });

  it("rejects a PDF without explicit or safely derived page metadata", () => {
    expect(inspectAsset(base(pdf(), "missing-pages.pdf", "application/pdf"))).toMatchObject({ ok: false, code: "METADATA_REQUIRED" });
  });

  it("rejects a PDF with non-finite page metadata", () => {
    expect(inspectAsset({ ...base(pdf(), "nan-pages.pdf", "application/pdf"), pageCount: Number.NaN })).toMatchObject({ ok: false, code: "METADATA_REQUIRED" });
  });

  it("rejects a mismatched signature, MIME, or extension with a UI-safe code", () => {
    const result = inspectAsset(base(pdf(), "brief.png", "image/png"));
    expect(result).toMatchObject({ ok: false, code: "MIME_MISMATCH" });
    expect(JSON.stringify(result)).not.toContain("%PDF");
  });

  it("rejects executables and PDF polyglots without returning content", () => {
    expect(inspectAsset(base(new TextEncoder().encode("MZ\x90\0"), "run.exe", "application/octet-stream"))).toMatchObject({ ok: false, code: "EXECUTABLE" });
    expect(inspectAsset(base(pdf("/JavaScript (bad)"), "bad.pdf", "application/pdf"))).toMatchObject({ ok: false, code: "DANGEROUS_PDF" });
    expect(inspectAsset(base(new TextEncoder().encode("%PDF-1.7\nMZ\x00"), "poly.pdf", "application/pdf"))).toMatchObject({ ok: false, code: "POLYGLOT" });
  });

  it("bounds image dimensions and rejects macro-bearing legacy office files", () => {
    expect(inspectAsset(base(png(20_001, 1), "wide.png", "image/png"))).toMatchObject({ ok: false, code: "DIMENSIONS_EXCEEDED" });
    expect(inspectAsset(base(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "old.xls", "application/vnd.ms-excel"))).toMatchObject({ ok: false, code: "MACRO_FORMAT" });
  });

  it("rejects unsupported types and never evaluates spreadsheet formulas", () => {
    expect(inspectAsset(base(new TextEncoder().encode("=HYPERLINK(\"https://evil\")"), "sheet.csv", "text/csv"))).toMatchObject({ ok: false, code: "FORMULA_PRESENT" });
  });

  it("rejects formulas in later CSV cells, not only when the payload starts with equals", () => {
    const csv = new TextEncoder().encode("name,total\nitem,=SUM(A1:A2)\n");
    expect(inspectAsset(base(csv, "sheet.csv", "text/csv"))).toMatchObject({ ok: false, code: "FORMULA_PRESENT" });
  });

  it("rejects compressed Office ZIP content as unverifiable", () => {
    const compressedWorksheetZipBytes = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x57, 0x08, 0x71, 0x0d, 0x0e,
      0x01, 0x00,
    ]);
    expect(inspectAsset(base(compressedWorksheetZipBytes, "compressed.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))).toMatchObject({ ok: false, code: "CONTENT_UNVERIFIABLE" });
  });

  it("rejects a truncated stored-entry Office ZIP without an end-of-directory record", () => {
    const truncatedStoredEntryZipBytes = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(inspectAsset(base(truncatedStoredEntryZipBytes, "truncated.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))).toMatchObject({ ok: false, code: "CONTENT_UNVERIFIABLE" });
  });
  it("rejects formulas embedded in supported XLSX worksheet XML", () => {
    const worksheet = new TextEncoder().encode(" xl/worksheets/sheet1.xml <worksheet><sheetData><f>SUM(A1:A2)</f></sheetData></worksheet>");
    const worksheetZipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04].concat(Array.from(worksheet)));
    expect(inspectAsset(base(worksheetZipBytes, "sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))).toMatchObject({ ok: false, code: "FORMULA_PRESENT" });
  });

  it("rejects supplied oversized dimensions and audio duration", () => {
    expect(inspectAsset({ ...base(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "photo.jpg", "image/jpeg"), width: 20_001, height: 1 })).toMatchObject({ ok: false, code: "DIMENSIONS_EXCEEDED" });
    expect(inspectAsset({ ...base(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), "voice.ogg", "audio/ogg"), audioDurationMs: 3_600_001 })).toMatchObject({ ok: false, code: "AUDIO_DURATION_EXCEEDED" });
  });

  it("requires audio metadata and enforces derived PDF page limits", () => {
    expect(inspectAsset(base(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), "voice.ogg", "audio/ogg"))).toMatchObject({ ok: false, code: "METADATA_REQUIRED" });
    expect(inspectAsset(base(pdf("/Type /Page /Type /Page"), "many.pdf", "application/pdf"), { maxPages: 1 })).toMatchObject({ ok: false, code: "PAGES_EXCEEDED" });
  });
});
