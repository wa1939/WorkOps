import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseIntakeBuffer, INTAKE_MAX_TEXT_CHARS } from "./intake-parse";

function xlsxBuf(aoa: unknown[][]): Buffer {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseIntakeBuffer", () => {
    it("parses an xlsx into headers + keyed rows", async () => {
        const buf = xlsxBuf([
            ["المهمة", "المسؤول", "تاريخ التسليم"],
            ["مهمة ١", "نوره", "2026\\08\\01"],
        ]);
        const parsed = await parseIntakeBuffer("plan.xlsx", buf);
        expect(parsed.kind).toBe("rows");
        if (parsed.kind !== "rows") return;
        expect(parsed.headers).toEqual(["المهمة", "المسؤول", "تاريخ التسليم"]);
        expect(parsed.rowCount).toBe(1);
        expect(parsed.rows[0]["المهمة"]).toBe("مهمة ١");
        expect(parsed.rows[0]["المسؤول"]).toBe("نوره");
    });

    it("skips leading empty rows and finds the header", async () => {
        const buf = xlsxBuf([[null, null], ["", ""], ["Title", "Owner"], ["A", "B"]]);
        const parsed = await parseIntakeBuffer("x.xlsx", buf);
        expect(parsed.kind).toBe("rows");
        if (parsed.kind !== "rows") return;
        expect(parsed.headers).toEqual(["Title", "Owner"]);
        expect(parsed.rowCount).toBe(1);
    });

    it("parses a txt document into text", async () => {
        const parsed = await parseIntakeBuffer("mom.txt", Buffer.from("Action: send report\nOwner: Ali", "utf8"));
        expect(parsed.kind).toBe("text");
        if (parsed.kind !== "text") return;
        expect(parsed.text).toContain("send report");
    });

    it("caps text length", async () => {
        const big = "x".repeat(INTAKE_MAX_TEXT_CHARS + 5000);
        const parsed = await parseIntakeBuffer("big.md", Buffer.from(big, "utf8"));
        expect(parsed.kind).toBe("text");
        if (parsed.kind !== "text") return;
        expect(parsed.text.length).toBeLessThanOrEqual(INTAKE_MAX_TEXT_CHARS);
        expect(parsed.truncated).toBe(true);
    });

    it("throws on unsupported extension", async () => {
        await expect(parseIntakeBuffer("x.pdf", Buffer.from("%PDF"))).rejects.toThrow("Unsupported file type");
    });
});
