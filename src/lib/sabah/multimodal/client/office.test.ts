import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { extractOfficeLocally, OFFICE_MAX_BYTES, OFFICE_MAX_ROWS, OFFICE_MAX_TEXT_CHARS } from "./office";

function exactArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function docxFile(paragraphs = ["Synthetic paragraph"], includeTable = true): Promise<File> {
  const zip = new JSZip();
  const paragraphXml = paragraphs.map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`).join("");
  const tableXml = includeTable ? `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` : "";
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphXml}${tableXml}</w:body></w:document>`);
  zip.file("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new File([bytes.buffer as ArrayBuffer], "notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

describe("extractOfficeLocally", () => {
  it("extracts DOCX paragraph and table provenance", async () => {
    const result = await extractOfficeLocally(await docxFile());
    expect(result.filename).toBe("notes.docx");
    expect(result.blocks.some((block) => block.kind === "paragraph" && block.text.includes("Synthetic paragraph"))).toBe(true);
    expect(result.blocks.some((block) => block.kind === "table" && block.text.includes("Cell A"))).toBe(true);
  });

  it("returns XLSX formulas as formula text with sheet/cell provenance", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["Value", "Formula"], [2, { f: "A2*3", v: 999 }]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Data");
    const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const result = await extractOfficeLocally(new File([exactArrayBuffer(bytes)], "calc.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const formula = result.blocks.find((block) => block.kind === "formula");
    expect(formula?.text).toBe("=A2*3");
    expect(formula?.provenance).toContain("Data!B2");
    expect(formula?.text).not.toContain("999");
  });

  it("supports bounded CSV and rejects legacy or macro formats", async () => {
    const csv = await extractOfficeLocally(new File(["Name,Value\nA,1\nB,2"], "rows.csv", { type: "text/csv" }));
    expect(csv.blocks.map((block) => block.text)).toContain("Name | Value");
    expect(csv.blocks.map((block) => block.text)).toContain("A | 1");
    await expect(extractOfficeLocally(new File(["x"], "old.xls", { type: "application/vnd.ms-excel" }))).rejects.toThrow(/unsupported|legacy/i);
    await expect(extractOfficeLocally(new File(["x"], "macro.xlsm", { type: "application/vnd.ms-excel.sheet.macroEnabled.12" }))).rejects.toThrow(/macro|unsupported/i);
    expect(OFFICE_MAX_BYTES).toBeGreaterThan(0); expect(OFFICE_MAX_ROWS).toBeGreaterThan(0);
  });

  it("bounds aggregate CSV text while retaining provenance and marking truncation", async () => {
    const source = `${"a".repeat(Math.floor(OFFICE_MAX_TEXT_CHARS * 0.6))},first\n${"b".repeat(Math.floor(OFFICE_MAX_TEXT_CHARS * 0.6))},second`;
    const result = await extractOfficeLocally(new File([source], "large.csv", { type: "text/csv" }));
    expect(result.blocks.map((block) => block.provenance)).toEqual(["CSV row 1", "CSV row 2"]);
    expect(result.blocks.reduce((sum, block) => sum + block.text.length, 0)).toBeLessThanOrEqual(OFFICE_MAX_TEXT_CHARS);
    expect(result.blocks[1].text.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });

  it("does not flag DOCX output at the global boundary because raw separators exceed it", async () => {
    const result = await extractOfficeLocally(await docxFile(["a".repeat(OFFICE_MAX_TEXT_CHARS / 2), "b".repeat(OFFICE_MAX_TEXT_CHARS / 2)], false));

    expect(result.blocks.reduce((sum, block) => sum + block.text.length, 0)).toBe(OFFICE_MAX_TEXT_CHARS);
    expect(result.truncated).toBe(false);
  });

  it("marks XLSX truncation only when an eligible cell exists beyond the row bound", async () => {
    const makeWorkbook = (count: number): File => {
      const ws = XLSX.utils.aoa_to_sheet(Array.from({ length: count }, (_, index) => [`value-${index}`]));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Data");
      const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      return new File([exactArrayBuffer(bytes)], `${count}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    };

    await expect(extractOfficeLocally(makeWorkbook(OFFICE_MAX_ROWS))).resolves.toMatchObject({ truncated: false });
    await expect(extractOfficeLocally(makeWorkbook(OFFICE_MAX_ROWS + 1))).resolves.toMatchObject({ truncated: true });
  });
});
