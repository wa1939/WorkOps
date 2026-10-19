import { describe, expect, it, vi } from "vitest";
import { LocalAsrClient, applyVocabularyCorrections, stitchTranscript, type AsrWorker } from "./asr-client";
import { isAsrWorkerRequest, isAsrWorkerResponse, type AsrEngine, type WorkerPort } from "./asr.worker";

describe("ASR protocol and local-first client", () => {
  it("validates bounded worker messages and timestamped segments", () => {
    expect(isAsrWorkerRequest({ type: "transcribe", requestId: "r", chunk: { index: 0, startMs: 0, endMs: 500, overlapSamples: 0, samples: new Float32Array(10) } })).toBe(true);
    expect(isAsrWorkerRequest({ type: "transcribe", requestId: "r", chunk: { index: 0, startMs: 0, endMs: 500, overlapSamples: 0, samples: new Float32Array(10_000_001) } })).toBe(false);
    expect(isAsrWorkerResponse({ type: "result", requestId: "r", segments: [{ text: "مرحبا", startMs: 0, endMs: 500, confidence: 0.9 }], engineVersion: "fixture" })).toBe(true);
  });

  it("stitches overlapping segment words without duplicate overlap", () => {
    expect(stitchTranscript([{ text: "مرحبا بكم في", startMs: 0, endMs: 500 }, { text: "في النظام اليوم", startMs: 400, endMs: 900 }])).toBe("مرحبا بكم في النظام اليوم");
  });

  it("records vocabulary corrections as provenance", () => {
    expect(applyVocabularyCorrections("مهمه للفريق", { "مهمه": "مهمة" })).toEqual({ text: "مهمة للفريق", corrections: [{ from: "مهمه", to: "مهمة", index: 0, source: "vocabulary" }] });
  });

  it("fails closed when the model manifest is unavailable before worker creation", async () => {
    const factory = vi.fn<() => AsrWorker>();
    const client = new LocalAsrClient(factory);
    await expect(client.transcribe(new Float32Array([0]), { sampleRate: 16_000 })).rejects.toMatchObject({ code: "MODEL_MANIFEST_UNAVAILABLE" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("reports progress, disposes, and rejects unavailable engines", async () => {
    const messages: unknown[] = [];
    const listeners: Array<(event: MessageEvent) => void> = [];
    const messageListeners: Array<(event: MessageEvent) => void> = []; const errorListeners: Array<(event: MessageEvent) => void> = []; const worker: AsrWorker = { postMessage: (message) => { messages.push(message); if ((message as { type: string }).type === "transcribe") { const requestId = (message as { requestId: string }).requestId; messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: { type: "progress", requestId, progress: 0.5 } }))); messageListeners.forEach((listener) => listener(new MessageEvent("message", { data: { type: "result", requestId, segments: [{ text: "جاهز", startMs: 0, endMs: 1, confidence: 1 }], engineVersion: "fixture" } }))); }; }, terminate: vi.fn(), addEventListener: (type, listener) => (type === "message" ? messageListeners : errorListeners).push(listener), removeEventListener: vi.fn() };
    const client = new LocalAsrClient(() => worker, { manifest: { "whispercpp-wasm": { id: "whispercpp-wasm", url: "https://example.test/engine", bytes: 1, sha256: "0".repeat(64), version: "1", license: "MIT" }, "whisper-multilingual": { id: "whisper-multilingual", url: "https://example.test/model", bytes: 1, sha256: "0".repeat(64), version: "1", license: "MIT" } }, loadAsset: async () => new Uint8Array([1]) });
    const progress: number[] = [];
    const promise = client.transcribe(new Float32Array([0]), { sampleRate: 16_000, onProgress: (value) => progress.push(value) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(progress).toEqual([0.5]);
    expect(messages.some((message) => (message as { type: string }).type === "dispose")).toBe(true);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("cleans every microphone track on stop and cancellation", () => {
    const stop = vi.fn();
    const session = LocalAsrClient.createCaptureSession();
    session.attachStream({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    session.cancel();
    session.stop();
    session.dispose();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("keeps the worker request/response engine injectable", async () => {
    const responses: unknown[] = [];
    let onmessage: WorkerPort["onmessage"] = null;
    const engine: AsrEngine = { transcribe: async () => ({ text: "جاهز", startMs: 0, endMs: 1, confidence: 1 }), dispose: vi.fn(async () => undefined) };
    const port: WorkerPort = { postMessage: (message) => responses.push(message), get onmessage() { return onmessage; }, set onmessage(value) { onmessage = value; } };
    expect(engine).toBeDefined(); expect(port).toBeDefined(); expect(responses).toEqual([]);
  });
});
