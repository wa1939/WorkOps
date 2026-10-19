export type OcrLanguage = "ara" | "eng";
export type OcrInput = { readonly assetId: string; readonly page: number; readonly image: unknown };
export type OcrWorkerRequest =
  | { readonly type: "initialize"; readonly languages: readonly OcrLanguage[]; readonly assets: Readonly<Record<OcrLanguage, Uint8Array>>; readonly psm: number }
  | { readonly type: "recognize"; readonly input: OcrInput }
  | { readonly type: "cancel" }
  | { readonly type: "dispose" };
export type WorkerWord = { readonly text: string; readonly confidence: number; readonly page?: number; readonly boundingBox?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } };
export type OcrWorkerResponse =
  | { readonly type: "progress"; readonly progress: number }
  | { readonly type: "result"; readonly blocks: readonly WorkerWord[]; readonly engineVersion: string; readonly truncated?: boolean }
  | { readonly type: "error"; readonly code: string; readonly message: string };
export type WorkerPort = {
  postMessage: (message: OcrWorkerResponse) => void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};
export type OcrEngine = {
  recognize: (image: unknown, psm: number, report: (progress: number) => void) => Promise<{ readonly blocks: readonly WorkerWord[]; readonly engineVersion: string }>;
  dispose: () => Promise<void>;
};

export const MAX_BLOCKS = 10_000;
export const MAX_OUTPUT_CHARS = 200_000;
export const MIN_PSM = 0;
export const MAX_PSM = 13;
export const MAX_TEXT_CHARS = 20_000;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isLanguage = (value: unknown): value is OcrLanguage => value === "ara" || value === "eng";
const isPsm = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= MIN_PSM && value <= MAX_PSM;
const isWord = (value: unknown): value is WorkerWord => {
  if (!isRecord(value) || typeof value.text !== "string" || value.text.length > MAX_TEXT_CHARS || typeof value.confidence !== "number" || !Number.isFinite(value.confidence)) return false;
  if (value.page !== undefined && (typeof value.page !== "number" || !Number.isInteger(value.page) || value.page < 1)) return false;
  if (value.boundingBox !== undefined) {
    const box = value.boundingBox;
    if (!isRecord(box) || [box.x, box.y, box.width, box.height].some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0)) return false;
  }
  return true;
};
export function isOcrWorkerRequest(value: unknown): value is OcrWorkerRequest {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "cancel" || value.type === "dispose") return true;
  if (value.type === "recognize") {
    const input = value.input;
    return isRecord(input) && typeof input.assetId === "string" && input.assetId.length > 0 && input.assetId.length <= 200 && typeof input.page === "number" && Number.isInteger(input.page) && input.page >= 1;
  }
  const assets = value.assets;
  if (value.type !== "initialize" || !Array.isArray(value.languages) || value.languages.length === 0 || value.languages.length > 2 || !value.languages.every(isLanguage) || !isPsm(value.psm) || !isRecord(assets)) return false;
  return value.languages.every((language) => assets[language] instanceof Uint8Array);
}
export function isOcrWorkerResponse(value: unknown): value is OcrWorkerResponse {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "progress") return typeof value.progress === "number" && Number.isFinite(value.progress) && value.progress >= 0 && value.progress <= 1;
  if (value.type === "error") return typeof value.code === "string" && value.code.length > 0 && value.code.length <= 100 && typeof value.message === "string" && value.message.length <= 500;
  return value.type === "result" && typeof value.engineVersion === "string" && value.engineVersion.length > 0 && value.engineVersion.length <= 100 && Array.isArray(value.blocks) && value.blocks.length <= MAX_BLOCKS && value.blocks.every(isWord) && value.blocks.reduce((total, word) => total + word.text.length, 0) <= MAX_OUTPUT_CHARS && value.truncated !== true;
}
export function isOcrWorkerResultOverLimit(value: unknown): boolean {
  if (!isRecord(value) || value.type !== "result") return false;
  if (value.truncated === true) return true;
  if (!Array.isArray(value.blocks) || value.blocks.length > MAX_BLOCKS) return true;
  const textLengths = value.blocks.map((block) => isRecord(block) && typeof block.text === "string" ? block.text.length : 0);
  return textLengths.some((length) => length > MAX_TEXT_CHARS) || textLengths.reduce((total, length) => total + length, 0) > MAX_OUTPUT_CHARS;
}

export function installOcrWorker(port: WorkerPort, createEngine: (languages: readonly OcrLanguage[], assets: Readonly<Record<OcrLanguage, Uint8Array>>, psm: number) => Promise<OcrEngine>): void {
  let engine: OcrEngine | null = null;
  let cancellationVersion = 0;
  let pageSegmentationMode = 3;
  let queue: Promise<void> = Promise.resolve();
  const postError = (code: string, message: string): void => port.postMessage({ type: "error", code, message: message.slice(0, 500) });
  const disposeEngine = async (): Promise<void> => { const current = engine; engine = null; if (current) await current.dispose(); };
  const handle = async (request: OcrWorkerRequest, requestVersion: number): Promise<void> => {
    if (request.type === "cancel") return;
    if (request.type === "dispose") { await disposeEngine(); return; }
    if (request.type === "initialize") {
      await disposeEngine();
      if (requestVersion !== cancellationVersion) return;
      pageSegmentationMode = request.psm;
      engine = await createEngine(request.languages, request.assets, request.psm);
      if (requestVersion !== cancellationVersion) await disposeEngine();
      return;
    }
    const current = engine;
    if (!current) throw new Error("OCR engine is not initialized");
    if (requestVersion !== cancellationVersion) { await disposeEngine(); return; }
    try {
      const result = await current.recognize(request.input.image, pageSegmentationMode, (progress) => { if (requestVersion === cancellationVersion) port.postMessage({ type: "progress", progress: Math.max(0, Math.min(1, progress)) }); });
      if (requestVersion !== cancellationVersion) return;
      if (!Array.isArray(result.blocks) || result.blocks.length > MAX_BLOCKS || !result.blocks.every(isWord) || result.blocks.reduce((total, word) => total + word.text.length, 0) > MAX_OUTPUT_CHARS || typeof result.engineVersion !== "string" || result.engineVersion.length === 0 || result.engineVersion.length > 100) {
        postError("OCR_OUTPUT_LIMIT", "OCR output exceeds the bounded result contract");
        return;
      }
      port.postMessage({ type: "result", blocks: result.blocks, engineVersion: result.engineVersion });
    } finally {
      await disposeEngine();
    }
  };
  port.onmessage = (event: MessageEvent<unknown>): void => {
    if (!isOcrWorkerRequest(event.data)) { postError("OCR_PROTOCOL_INVALID", "Invalid OCR worker request"); return; }
    const request = event.data;
    if (request.type === "cancel" || request.type === "dispose") cancellationVersion += 1;
    const requestVersion = cancellationVersion;
    queue = queue.then(() => handle(request, requestVersion)).catch((error: unknown) => { postError("OCR_WORKER_FAILED", error instanceof Error ? error.message : "OCR worker failed"); return disposeEngine(); });
  };
}

const workerScope = globalThis as unknown as Partial<WorkerPort>;
if (typeof document === "undefined" && typeof workerScope.postMessage === "function") {
  installOcrWorker(workerScope as WorkerPort, async () => { throw new Error("OCR engine bundle unavailable"); });
}
