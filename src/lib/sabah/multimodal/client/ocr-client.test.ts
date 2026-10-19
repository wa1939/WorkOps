import { describe, expect, it, vi } from "vitest";
import { LocalOcrClient, type OcrWorker, type OcrWorkerFactory } from "./ocr-client";
import { installOcrWorker, type OcrEngine, type WorkerPort } from "./ocr.worker";

function workerHarness(behavior: "result" | "manual" = "result") {
  const messages: unknown[] = [];
  const messageListeners: Array<(event: MessageEvent) => void> = [];
  const errorListeners: Array<(event: MessageEvent) => void> = [];
  const emit = (data: unknown): void => messageListeners.forEach((listener) => listener(new MessageEvent("message", { data })));
  const worker: OcrWorker = {
    postMessage: (message) => {
      messages.push(message);
      const request = message as { type: string };
      if (request.type === "recognize" && behavior === "result") {
        setTimeout(() => {
          emit({ type: "progress", progress: 0.5 });
          emit({ type: "result", engineVersion: "fixture-tesseract", blocks: [{ text: "مرحبا hello", page: 2, confidence: 0.91, boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } }] });
        }, 0);
      }
    },
    terminate: vi.fn(),
    addEventListener: (type, listener) => { (type === "message" ? messageListeners : errorListeners).push(listener); },
    removeEventListener: () => undefined,
  };
  return { messages, worker, factory: (() => worker) as OcrWorkerFactory, emitMalformed: () => emit({ type: "unexpected" }), emitOverLimit: () => emit({ type: "result", engineVersion: "fixture", blocks: [{ text: "x".repeat(20001), confidence: 0.5 }] }) };
}

describe("LocalOcrClient", () => {
  it("fails closed before creating a worker when model manifest entries are absent", async () => {
    const factory = vi.fn<OcrWorkerFactory>();
    const client = new LocalOcrClient(factory);
    await expect(client.recognize({ assetId: "scan", page: 1, image: {} }, { languages: ["ara", "eng"] })).rejects.toMatchObject({ code: "MODEL_MANIFEST_UNAVAILABLE" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("maps typed worker progress and layout records and disposes on completion", async () => {
    const harness = workerHarness();
    const progress: number[] = [];
    const client = new LocalOcrClient(harness.factory, {
      manifest: {
        "tesseract-ara": { id: "tesseract-ara", url: "https://example.test/ara", bytes: 1, sha256: "0".repeat(64), version: "1", license: "MIT" },
        "tesseract-eng": { id: "tesseract-eng", url: "https://example.test/eng", bytes: 1, sha256: "0".repeat(64), version: "1", license: "MIT" },
      },
      loadAsset: async () => new Uint8Array([1]),
    });
    const result = await client.recognize({ assetId: "scan", page: 1, image: {} }, { languages: ["ara", "eng"], onProgress: (value) => progress.push(value) });
    expect(progress).toEqual([0.5]);
    expect(result.blocks[0]).toMatchObject({ assetId: "scan", page: 2, text: "مرحبا hello", confidence: 0.91, kind: "TEXT" });
    expect(result.blocks[0].boundingBox).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.1 });
    expect(harness.worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects malformed worker messages instead of leaving recognition pending", async () => {
    const harness = workerHarness("manual");
    const client = new LocalOcrClient(harness.factory, { manifest: { "tesseract-eng": { id: "tesseract-eng", url: "https://example.test/eng", bytes: 1, sha256: "0".repeat(64), version: "1", license: "MIT" } }, loadAsset: async () => new Uint8Array([1]) });
    const promise = client.recognize({ assetId: "scan", page: 1, image: {} }, { languages: ["eng"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.emitMalformed();
    await expect(promise).rejects.toMatchObject({ code: "OCR_PROTOCOL_INVALID" });
  });

  it("rejects over-limit worker output without mapping a truncated result", async () => {
    const harness = workerHarness("manual");
    const client = new LocalOcrClient(harness.factory, { manifest: { "tesseract-eng": { id: "tesseract-eng", url: "https://example.test/eng", bytes: 1, sha256: "0".repeat(64), version: "1", license: "MIT" } }, loadAsset: async () => new Uint8Array([1]) });
    const promise = client.recognize({ assetId: "scan", page: 1, image: {} }, { languages: ["eng"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.emitOverLimit();
    await expect(promise).rejects.toMatchObject({ code: "OCR_OUTPUT_LIMIT" });
  });

  it("validates psm before loading assets", async () => {
    const loadAsset = vi.fn(async () => new Uint8Array([1]));
    const client = new LocalOcrClient(() => workerHarness().worker, { manifest: { "tesseract-eng": { id: "tesseract-eng", url: "https://example.test/eng", bytes: 1, sha256: "0".repeat(64), version: "1", license: "MIT" } }, loadAsset });
    await expect(client.recognize({ assetId: "scan", page: 1, image: {} }, { languages: ["eng"], psm: 99 })).rejects.toMatchObject({ code: "OCR_PROTOCOL_INVALID" });
    expect(loadAsset).not.toHaveBeenCalled();
  });

  it("cancels and terminates the worker when the signal aborts", async () => {
    const harness = workerHarness();
    const controller = new AbortController();
    const client = new LocalOcrClient(harness.factory, { manifest: { "tesseract-eng": { id: "tesseract-eng", url: "https://example.test/eng", bytes: 1, sha256: "0".repeat(64), version: "1", license: "MIT" } }, loadAsset: async () => new Uint8Array([1]) });
    const promise = client.recognize({ assetId: "scan", page: 1, image: {} }, { languages: ["eng"] }, controller.signal);
    setTimeout(() => controller.abort(), 0);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.messages).toContainEqual({ type: "cancel" });
    expect(harness.worker.terminate).toHaveBeenCalledOnce();
  });

  it("honors cancellation queued during initialization before recognition starts", async () => {
    const responses: unknown[] = [];
    let onmessage: WorkerPort["onmessage"] = null;
    let resolveInitialization!: () => void;
    const initialization = new Promise<void>((resolve) => { resolveInitialization = resolve; });
    const recognize = vi.fn(async () => ({ blocks: [], engineVersion: "fixture" }));
    const dispose = vi.fn(async () => undefined);
    const engine: OcrEngine = { recognize, dispose };
    const port: WorkerPort = {
      postMessage: (message) => { responses.push(message); },
      get onmessage() { return onmessage; },
      set onmessage(value) { onmessage = value; },
    };
    installOcrWorker(port, async () => { await initialization; return engine; });
    const send = (request: unknown): void => { onmessage?.(new MessageEvent("message", { data: request })); };
    send({ type: "initialize", languages: ["eng"], assets: { eng: new Uint8Array([1]) }, psm: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    send({ type: "recognize", input: { assetId: "scan", page: 1, image: {} } });
    send({ type: "cancel" });
    resolveInitialization();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recognize).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    expect(responses).not.toContainEqual(expect.objectContaining({ type: "result" }));

    send({ type: "initialize", languages: ["eng"], assets: { eng: new Uint8Array([1]) }, psm: 3 });
    send({ type: "recognize", input: { assetId: "scan", page: 1, image: {} } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recognize).toHaveBeenCalledOnce();
    expect(responses).toContainEqual(expect.objectContaining({ type: "result" }));
  });

  it("rejects with AbortError when posting cancellation throws", async () => {
    const harness = workerHarness("manual");
    const originalPostMessage = harness.worker.postMessage;
    vi.spyOn(harness.worker, "postMessage").mockImplementation((message) => {
      if (message.type === "cancel") throw new Error("worker unavailable");
      originalPostMessage(message);
    });
    const controller = new AbortController();
    const client = new LocalOcrClient(harness.factory, { manifest: { "tesseract-eng": { id: "tesseract-eng", url: "https://example.test/eng", bytes: 1, sha256: "0".repeat(64), version: "1", license: "MIT" } }, loadAsset: async () => new Uint8Array([1]) });
    const promise = client.recognize({ assetId: "scan", page: 1, image: {} }, { languages: ["eng"] }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.worker.terminate).toHaveBeenCalledOnce();
  });
});
