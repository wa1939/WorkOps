import { describe, expect, it, vi } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPdfText, PDF_MAX_BYTES, PDF_MAX_PAGES, PDF_MAX_TEXT_CHARS } from "./pdf";

function pdfWithPages(pages: string[]): Uint8Array {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] /Count ${pages.length} >>`];
  pages.forEach((text, i) => {
    const page = 3 + i * 3;
    const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1  ${4 + i * 3} 0 R >> >> /Contents ${5 + i * 3} 0 R >>`);
    objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((object, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe("extractPdfText", () => {
  it("preserves ordered pages, filename, and normalizes text", async () => {
    const file = new File([pdfWithPages([" first   page ", "second\tpage"]).buffer as ArrayBuffer], "ordered.pdf", { type: "application/pdf" });
    const result = await extractPdfText(file);
    expect(result.filename).toBe("ordered.pdf");
    expect(result.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(result.pages.map((page) => page.text)).toEqual(["first page", "second page"]);
  });

  it("does not mutate the original input and enforces bounds", async () => {
    const bytes = pdfWithPages(["unchanged"]);
    const before = bytes.slice();
    await extractPdfText(new File([bytes.buffer as ArrayBuffer], "bounded.pdf", { type: "application/pdf" }));
    expect(bytes).toEqual(before);
    expect(PDF_MAX_BYTES).toBeGreaterThan(0);
    expect(PDF_MAX_PAGES).toBeGreaterThan(0);
    expect(PDF_MAX_TEXT_CHARS).toBeGreaterThan(0);
  });

  it("destroys the loading task when document loading rejects", async () => {
    const task = pdfjs.getDocument({ data: new Uint8Array([1, 2, 3]), stopAtErrors: true });
    const destroy = vi.spyOn(task, "destroy");
    await expect(extractPdfText(new File([new Uint8Array([1, 2, 3])], "broken.pdf"), () => task)).rejects.toThrow();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("attempts task destruction after cleanup failure and preserves extraction failure", async () => {
    const primaryError = new Error("page extraction failed");
    const cleanup = vi.fn().mockRejectedValue(new Error("cleanup failed"));
    const destroy = vi.fn().mockResolvedValue(undefined);
    const task = { promise: Promise.resolve({ numPages: 1, getPage: vi.fn().mockRejectedValue(primaryError), cleanup }), destroy } as unknown as ReturnType<typeof pdfjs.getDocument>;

    await expect(extractPdfText(new File([new Uint8Array([1])], "broken-page.pdf"), () => task)).rejects.toBe(primaryError);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
