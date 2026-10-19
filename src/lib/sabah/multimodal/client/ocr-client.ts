import { LOCAL_MODEL_MANIFEST, loadVerifiedModelAsset, type GeneratedModelManifest } from "../model-manifest";
import { sourceBlockSchema, type SourceBlock } from "../contracts";
import { preprocessImage, type PreprocessOptions } from "./image-preprocess";
import { MAX_BLOCKS, MAX_OUTPUT_CHARS, MAX_PSM, MIN_PSM, isOcrWorkerResponse, isOcrWorkerResultOverLimit, type OcrInput, type OcrLanguage, type OcrWorkerRequest, type WorkerWord } from "./ocr.worker";

export type OcrWorker = {
  postMessage: (message: OcrWorkerRequest) => void;
  terminate: () => void;
  addEventListener: (type: "message" | "error", listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: "message" | "error", listener: (event: MessageEvent) => void) => void;
};
export type OcrWorkerFactory = () => OcrWorker;
export type OcrClientOptions = {
  readonly manifest?: GeneratedModelManifest;
  readonly loadAsset?: typeof loadVerifiedModelAsset;
  readonly workerFactory?: OcrWorkerFactory;
};
export type OcrRecognizeOptions = {
  readonly languages: readonly OcrLanguage[];
  readonly psm?: number;
  readonly preprocess?: PreprocessOptions;
  readonly onProgress?: (progress: number) => void;
};
export type OcrResult = { readonly blocks: readonly SourceBlock[]; readonly engineVersion: string };

const defaultWorkerFactory: OcrWorkerFactory = () => new Worker(new URL("./ocr.worker.ts", import.meta.url), { type: "module" });
function hashText(text: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
}
function clamp(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
function mapBlock(input: OcrInput, word: WorkerWord, engineVersion: string, index: number): Promise<SourceBlock> {
  const text = word.text.slice(0, 20_000);
  return hashText(text).then((checksum) => sourceBlockSchema.parse({
    id: `${input.assetId}:ocr:${input.page}:${index}`,
    assetId: input.assetId,
    kind: "TEXT",
    text,
    page: word.page ?? input.page,
    boundingBox: word.boundingBox,
    confidence: clamp(word.confidence),
    engine: "tesseract",
    engineVersion,
    checksum,
    reviewed: false,
  }));
}

export class LocalOcrClient {
  private readonly factory: OcrWorkerFactory;
  private readonly manifest: GeneratedModelManifest;
  private readonly loadAsset: typeof loadVerifiedModelAsset;
  private readonly cache = new Map<string, Uint8Array>();

  public constructor(workerFactory: OcrWorkerFactory = defaultWorkerFactory, options: OcrClientOptions = {}) {
    this.factory = options.workerFactory ?? workerFactory;
    this.manifest = options.manifest ?? LOCAL_MODEL_MANIFEST;
    this.loadAsset = options.loadAsset ?? loadVerifiedModelAsset;
  }

  public async recognize(input: OcrInput, options: OcrRecognizeOptions, signal?: AbortSignal): Promise<OcrResult> {
    const languages = Array.from(new Set(options.languages));
    const psm = options.psm ?? 3;
    if (languages.length === 0 || languages.length > 2 || languages.some((language) => language !== "ara" && language !== "eng")) throw new Error("Arabic or English language selection is required");
    if (!Number.isInteger(psm) || psm < MIN_PSM || psm > MAX_PSM) throw Object.assign(new Error("Invalid OCR page segmentation mode"), { code: "OCR_PROTOCOL_INVALID" });
    const assets = {} as Record<OcrLanguage, Uint8Array>;
    for (const language of languages) {
      const entry = this.manifest[`tesseract-${language}`];
      assets[language] = await this.loadAsset(entry, this.cache, fetch, signal);
    }
    if (signal?.aborted) throw new DOMException("The OCR request was aborted", "AbortError");
    const worker = this.factory();
    const prepared = input.image !== null && typeof input.image === "object" && "width" in input.image && "height" in input.image
      ? preprocessImage(input.image as { width: number; height: number }, options.preprocess)
      : null;
    return new Promise<OcrResult>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
        try { worker.postMessage({ type: "dispose" }); } catch { /* termination still releases the browser worker */ }
        worker.terminate();
      };
      const finishError = (error: unknown): void => { if (!settled) { settled = true; cleanup(); reject(error); } };
      const onAbort = (): void => {
        if (!settled) {
          try { worker.postMessage({ type: "cancel" }); } catch { /* termination still releases the browser worker */ }
          finishError(new DOMException("The OCR request was aborted", "AbortError"));
        }
      };
      const onError = (): void => finishError(new Error("OCR worker failed"));
      const onMessage = (event: MessageEvent): void => {
        if (isOcrWorkerResultOverLimit(event.data)) {
          finishError(Object.assign(new Error("OCR output exceeds the bounded result contract"), { code: "OCR_OUTPUT_LIMIT" }));
          return;
        }
        if (!isOcrWorkerResponse(event.data)) {
          finishError(Object.assign(new Error("Invalid OCR worker response"), { code: "OCR_PROTOCOL_INVALID" }));
          return;
        }
        const response = event.data;
        if (response.type === "progress") options.onProgress?.(response.progress);
        if (response.type === "error") finishError(Object.assign(new Error(response.message), { code: response.code }));
        if (response.type === "result") Promise.all(response.blocks.slice(0, MAX_BLOCKS).map((word, index) => mapBlock(input, word, response.engineVersion, index))).then((blocks) => {
          if (!settled) { settled = true; cleanup(); resolve({ blocks, engineVersion: response.engineVersion }); }
        }).catch(finishError);
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      try {
        worker.postMessage({ type: "initialize", languages, assets, psm });
        worker.postMessage({ type: "recognize", input: { ...input, image: prepared?.canvas ?? input.image } });
      } catch (error: unknown) {
        finishError(error instanceof Error ? error : new Error("OCR worker request failed"));
      }
    });
  }
}
