export type CsvValue = unknown;

function csvCell(value: CsvValue): string {
    if (value == null) return "";
    const text = value instanceof Date ? value.toISOString() : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serialize a header row and records as an RFC 4180-compatible CSV document. */
export function serializeCsv(
    headers: readonly CsvValue[],
    rows: readonly (readonly CsvValue[])[] = [],
): string {
    const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
    return `${lines.join("\r\n")}\r\n`;
}
