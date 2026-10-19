import type { PcmChunk } from "./wav";

export type AsrSegment = { readonly text: string; readonly startMs: number; readonly endMs: number; readonly confidence: number };
export type AsrWorkerRequest =
  | { readonly type: "initialize"; readonly requestId: string; readonly engineAsset: Uint8Array; readonly modelAsset: Uint8Array }
  | { readonly type: "transcribe"; readonly requestId: string; readonly chunk: PcmChunk }
  | { readonly type: "cancel"; readonly requestId: string }
  | { readonly type: "dispose"; readonly requestId: string };
export type AsrWorkerResponse =
  | { readonly type: "progress"; readonly requestId: string; readonly progress: number }
  | { readonly type: "result"; readonly requestId: string; readonly segments: readonly AsrSegment[]; readonly engineVersion: string }
  | { readonly type: "error"; readonly requestId: string; readonly code: string; readonly message: string };
export type WorkerPort = { postMessage: (message: AsrWorkerResponse) => void; onmessage: ((event: MessageEvent<unknown>) => void) | null };
export type AsrEngine = { transcribe: (chunk: PcmChunk, report: (progress: number) => void) => Promise<AsrSegment>; dispose: () => Promise<void> };
export const MAX_ASR_SAMPLES = 10_000_000; export const MAX_ASR_TEXT = 20_000; export const MAX_ASR_SEGMENTS = 1_000;
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const validSegment = (v: unknown): v is AsrSegment => record(v) && typeof v.text === "string" && v.text.length <= MAX_ASR_TEXT && typeof v.startMs === "number" && Number.isInteger(v.startMs) && v.startMs >= 0 && typeof v.endMs === "number" && Number.isInteger(v.endMs) && v.endMs >= v.startMs && typeof v.confidence === "number" && v.confidence >= 0 && v.confidence <= 1;
export function isAsrWorkerRequest(value: unknown): value is AsrWorkerRequest {
  if (!record(value) || typeof value.type !== "string" || typeof value.requestId !== "string" || value.requestId.length === 0) return false;
  if (value.type === "cancel" || value.type === "dispose") return true;
  if (value.type === "initialize") return value.engineAsset instanceof Uint8Array && value.modelAsset instanceof Uint8Array && value.engineAsset.length > 0 && value.modelAsset.length > 0;
  if (value.type !== "transcribe" || !record(value.chunk)) return false;
  const chunk = value.chunk;
  return chunk.samples instanceof Float32Array && chunk.samples.length <= MAX_ASR_SAMPLES && typeof chunk.startMs === "number" && Number.isInteger(chunk.startMs) && typeof chunk.endMs === "number" && Number.isInteger(chunk.endMs) && chunk.endMs >= chunk.startMs;
}
export function isAsrWorkerResponse(value: unknown): value is AsrWorkerResponse {
  if (!record(value) || typeof value.type !== "string" || typeof value.requestId !== "string") return false;
  if (value.type === "progress") return typeof value.progress === "number" && value.progress >= 0 && value.progress <= 1;
  if (value.type === "error") return typeof value.code === "string" && value.code.length <= 100 && typeof value.message === "string" && value.message.length <= 500;
  return value.type === "result" && typeof value.engineVersion === "string" && value.engineVersion.length > 0 && Array.isArray(value.segments) && value.segments.length <= MAX_ASR_SEGMENTS && value.segments.every(validSegment);
}
export function installAsrWorker(port: WorkerPort, createEngine: (engineAsset: Uint8Array, modelAsset: Uint8Array) => Promise<AsrEngine>): void {
  let engine: AsrEngine | null = null; let cancelled = false; let queue = Promise.resolve();
  const error = (requestId: string, code: string, message: string): void => port.postMessage({ type: "error", requestId, code, message: message.slice(0, 500) });
  port.onmessage = (event) => { if (!isAsrWorkerRequest(event.data)) { error("unknown", "ASR_PROTOCOL_INVALID", "Invalid ASR worker request"); return; } const request = event.data; if (request.type === "cancel") { cancelled = true; return; } if (request.type === "dispose") { cancelled = true; const current = engine; engine = null; queue = queue.then(() => current?.dispose()).then(() => undefined); return; } queue = queue.then(async () => { if (request.type === "initialize") { await engine?.dispose(); engine = await createEngine(request.engineAsset, request.modelAsset); cancelled = false; return; } if (!engine) { error(request.requestId, "ASR_ENGINE_UNAVAILABLE", "ASR engine is not initialized"); return; } if (cancelled) return; const current = await engine.transcribe(request.chunk, (progress) => { if (!cancelled) port.postMessage({ type: "progress", requestId: request.requestId, progress: Math.max(0, Math.min(1, progress)) }); }); if (!cancelled && validSegment(current)) port.postMessage({ type: "result", requestId: request.requestId, segments: [current], engineVersion: "injected" }); }).catch((cause: unknown) => error(request.requestId, "ASR_ENGINE_UNAVAILABLE", cause instanceof Error ? cause.message : "ASR engine unavailable")); };
}
const workerScope = globalThis as unknown as Partial<WorkerPort>; if (typeof document === "undefined" && typeof workerScope.postMessage === "function") installAsrWorker(workerScope as WorkerPort, async () => { throw new Error("ASR engine bundle unavailable"); });
