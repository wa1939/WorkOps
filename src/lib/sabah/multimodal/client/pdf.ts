import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { measureExtractionCoverage, type CoveragePage, type CoverageMetrics } from "../coverage";

export const PDF_MAX_BYTES = 2 * 1024 * 1024;
export const PDF_MAX_PAGES = 100;
export const PDF_MAX_TEXT_CHARS = 30_000;
export interface PdfPage extends CoveragePage { text: string }
export interface PdfExtraction { filename: string; pages: PdfPage[]; coverage: CoverageMetrics; truncated: boolean }

type PdfInput = Blob | Uint8Array | ArrayBuffer;
export type PdfDocumentLoader = (params: Parameters<typeof pdfjs.getDocument>[0]) => ReturnType<typeof pdfjs.getDocument>;
function bytes(input: PdfInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return Promise.resolve(new Uint8Array(input));
  if (input instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(input.slice(0)));
  return input.arrayBuffer().then((value) => new Uint8Array(value));
}
function normalize(value: string): string { return value.replace(/\s+/g, " ").trim(); }

export async function extractPdfText(file: PdfInput & { name?: string }, loadDocument: PdfDocumentLoader = pdfjs.getDocument): Promise<PdfExtraction> {
  const data = await bytes(file);
  if (data.byteLength > PDF_MAX_BYTES) throw new Error("PDF exceeds input bound");
  const task = loadDocument({ data, isEvalSupported: false, disableAutoFetch: true, disableStream: true, stopAtErrors: true } as Parameters<typeof pdfjs.getDocument>[0] & { isEvalSupported?: boolean });
  let document: Awaited<typeof task.promise> | null = null;
  let primaryError = false;
  try {
    document = await task.promise;
    const count = Math.min(document.numPages, PDF_MAX_PAGES);
    const pages: PdfPage[] = [];
    let remaining = PDF_MAX_TEXT_CHARS;
    for (let index = 1; index <= count; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const text = normalize(content.items.map((item) => "str" in item ? item.str : "").join(" ")).slice(0, Math.max(0, remaining));
      remaining -= text.length;
      pages.push({ page: index, text, blocks: text ? 1 : 0 });
    }
    const coverage = measureExtractionCoverage(pages);
    return { filename: file.name ?? "unnamed.pdf", pages, coverage, truncated: document.numPages > count || remaining <= 0 };
  } catch (error) {
    primaryError = true;
    throw error;
  } finally {
    let cleanupError: unknown;
    let destroyError: unknown;
    if (document) {
      try { await document.cleanup(); } catch (error) { cleanupError = error; }
    }
    try { await task.destroy(); } catch (error) { destroyError = error; }
    if (!primaryError) {
      if (cleanupError) throw cleanupError;
      if (destroyError) throw destroyError;
    }
  }
}
