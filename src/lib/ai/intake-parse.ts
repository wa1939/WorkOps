import * as XLSX from "xlsx";
import mammoth from "mammoth";

export const INTAKE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const INTAKE_MAX_ROWS = 400;
export const INTAKE_MAX_TEXT_CHARS = 30_000;
export const INTAKE_EXTENSIONS = [".xlsx", ".xls", ".csv", ".txt", ".md", ".docx"] as const;

export type ParsedIntake =
    | { kind: "rows"; headers: string[]; rows: Record<string, string>[]; rowCount: number; truncated: boolean }
    | { kind: "text"; text: string; truncated: boolean };

function ext(filename: string): string {
    const i = filename.lastIndexOf(".");
    return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

function cell(v: unknown): string {
    if (v === null || v === undefined) return "";
    return String(v).trim();
}

/** Parse a tabular sheet into headers + keyed rows. Header = first row with ≥2 non-empty cells. */
function parseSheet(rows: unknown[][]): ParsedIntake {
    const headerIdx = rows.findIndex((r) => r.filter((c) => cell(c) !== "").length >= 2);
    if (headerIdx < 0) return { kind: "rows", headers: [], rows: [], rowCount: 0, truncated: false };

    const rawHeaders = rows[headerIdx];
    const headers = rawHeaders.map((h, i) => cell(h) || `col${i + 1}`);

    const out: Record<string, string>[] = [];
    let truncated = false;
    for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.every((c) => cell(c) === "")) continue;
        if (out.length >= INTAKE_MAX_ROWS) {
            truncated = true;
            break;
        }
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
            const val = cell(row[i]);
            if (val) obj[h] = val;
        });
        out.push(obj);
    }
    return { kind: "rows", headers, rows: out, rowCount: out.length, truncated };
}

/**
 * Parse an uploaded file buffer into rows (tabular) or text (document). Reads
 * computed cell values only — never evaluates formulas or executes content.
 */
export async function parseIntakeBuffer(filename: string, buffer: Buffer): Promise<ParsedIntake> {
    const e = ext(filename);

    if (e === ".xlsx" || e === ".xls" || e === ".csv") {
        // codepage 65001 = UTF-8, so Arabic in CSV files isn't garbled to Latin-1.
        const wb = XLSX.read(buffer, { type: "buffer", codepage: 65001 });
        for (const name of wb.SheetNames) {
            const ws = wb.Sheets[name];
            const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: false });
            const parsed = parseSheet(rows);
            if (parsed.kind === "rows" && parsed.rowCount > 0) return parsed;
        }
        // No sheet yielded rows — return an empty tabular result.
        return { kind: "rows", headers: [], rows: [], rowCount: 0, truncated: false };
    }

    if (e === ".docx") {
        const { value } = await mammoth.extractRawText({ buffer });
        const truncated = value.length > INTAKE_MAX_TEXT_CHARS;
        return { kind: "text", text: value.slice(0, INTAKE_MAX_TEXT_CHARS), truncated };
    }

    if (e === ".txt" || e === ".md") {
        const value = buffer.toString("utf8");
        const truncated = value.length > INTAKE_MAX_TEXT_CHARS;
        return { kind: "text", text: value.slice(0, INTAKE_MAX_TEXT_CHARS), truncated };
    }

    throw new Error("Unsupported file type");
}
