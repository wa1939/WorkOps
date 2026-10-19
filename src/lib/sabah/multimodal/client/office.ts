import * as XLSX from "xlsx";
import mammoth from "mammoth";

export const OFFICE_MAX_BYTES = 2 * 1024 * 1024;
export const OFFICE_MAX_ROWS = 400;
export const OFFICE_MAX_TEXT_CHARS = 30_000;
export interface OfficeBlock { kind: "paragraph" | "table" | "cell" | "formula" | "row"; text: string; provenance: string }
export interface OfficeExtraction { filename: string; blocks: OfficeBlock[]; truncated: boolean }
type OfficeInput = Blob | Uint8Array | ArrayBuffer;
type OfficeOutputState = { remaining: number; truncated: boolean };

async function inputBytes(input: OfficeInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return new Uint8Array(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  return new Uint8Array(await input.arrayBuffer());
}
function extension(name: string): string { return name.slice(name.lastIndexOf(".")).toLowerCase(); }
function text(value: unknown): string { return value === null || value === undefined ? "" : String(value).trim(); }
function appendBlock(blocks: OfficeBlock[], state: OfficeOutputState, block: Omit<OfficeBlock, "text"> & { text: string }): void {
  if (!block.text) return;
  const output = block.text.slice(0, state.remaining);
  if (output) blocks.push({ ...block, text: output });
  if (output.length < block.text.length) state.truncated = true;
  state.remaining -= output.length;
}
function csvRows(source: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < source.length && rows.length <= OFFICE_MAX_ROWS; i += 1) { const c = source[i];
    if (c === '"') { if (quoted && source[i + 1] === '"') { field += '"'; i += 1; } else quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(field); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && source[i + 1] === "\n") i += 1; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); } return rows;
}

export async function extractOfficeLocally(file: OfficeInput & { name?: string; type?: string }): Promise<OfficeExtraction> {
  const name = file.name ?? "unnamed"; const ext = extension(name);
  if ([".xls", ".xlsb", ".xlsm", ".xltm", ".doc"].includes(ext) || /macroEnabled|ms-excel/i.test(file.type ?? "")) throw new Error("Unsupported legacy or macro Office format");
  const data = await inputBytes(file); if (data.byteLength > OFFICE_MAX_BYTES) throw new Error("Office input exceeds bound");
  const blocks: OfficeBlock[] = []; const state: OfficeOutputState = { remaining: OFFICE_MAX_TEXT_CHARS, truncated: false };
  if (ext === ".csv") {
    const rows = csvRows(new TextDecoder().decode(data));
    rows.slice(0, OFFICE_MAX_ROWS).forEach((row, index) => appendBlock(blocks, state, { kind: index === 0 ? "row" : "cell", text: row.map(text).join(" | "), provenance: `CSV row ${index + 1}` }));
    state.truncated ||= rows.length > OFFICE_MAX_ROWS; return { filename: name, blocks, truncated: state.truncated };
  }
  if (ext === ".docx") {
    const buffer = Buffer.from(data);
    const raw = await mammoth.extractRawText({ buffer });
    const html = await mammoth.convertToHtml({ buffer });
    const paragraphs = raw.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    paragraphs.forEach((value, index) => appendBlock(blocks, state, { kind: "paragraph", text: value, provenance: `DOCX paragraph ${index + 1}` }));
    const tableMatches = html.value.match(/<table[\s\S]*?<\/table>/gi) ?? [];
    tableMatches.forEach((table, index) => { const cells = Array.from(table.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)).map((match) => match[1].replace(/<[^>]+>/g, "").trim()); appendBlock(blocks, state, { kind: "table", text: cells.join(" | "), provenance: `DOCX table ${index + 1}` }); });
    return { filename: name, blocks, truncated: state.truncated };
  }
  if (ext !== ".xlsx") throw new Error("Unsupported Office file type");
  const workbook = XLSX.read(data, { type: "array", cellFormula: true, cellNF: false, cellHTML: false, bookVBA: false });
  let count = 0;
  let sourceOverflow = false;
  outer: for (const sheetName of workbook.SheetNames) { const sheet = workbook.Sheets[sheetName]; const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
    for (let r = range.s.r; r <= range.e.r; r += 1) for (let c = range.s.c; c <= range.e.c; c += 1) { const address = XLSX.utils.encode_cell({ r, c }); const cell = sheet[address]; if (!cell) continue; const value = typeof cell.f === "string" ? `=${cell.f}` : text(cell.v); if (!value) continue; if (count >= OFFICE_MAX_ROWS) { sourceOverflow = true; break outer; } appendBlock(blocks, state, { kind: cell.f ? "formula" : "cell", text: value, provenance: `${sheetName}!${address}` }); count += 1; }
  }
  state.truncated ||= sourceOverflow; return { filename: name, blocks, truncated: state.truncated };
}
