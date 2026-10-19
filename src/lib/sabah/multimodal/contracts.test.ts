import { describe, expect, it } from "vitest";
import {
  assetDescriptorSchema,
  extractionMetricsSchema,
  extractionRunResultSchema,
  intakeRequestSchema,
  processingConsentSchema,
  sourceBlockSchema,
} from "./contracts";
import { serializeSourceBlock, sourceBlockJsonSchema } from "./source-blocks";

describe("Sabah multimodal contracts", () => {
  it("requires page or time provenance for every source block", () => {
    expect(() => sourceBlockSchema.parse({
      id: "b1", assetId: "a1", kind: "TEXT", text: "content", confidence: 0.9,
      engine: "ocr", engineVersion: "1", checksum: "a".repeat(64), reviewed: false,
    })).toThrow(/page|time/i);
  });

  it("defaults to local preferred and cannot represent implicit cloud consent", () => {
    expect(intakeRequestSchema.parse({ assets: [] }).mode).toBe("LOCAL_PREFERRED");
    expect(processingConsentSchema.safeParse({ provider: "zai" }).success).toBe(false);
  });

  it("bounds provenance, confidence, and bounding boxes", () => {
    const base = { id: "b1", assetId: "a1", kind: "TEXT", text: "content", page: 1,
      confidence: 0.9, engine: "ocr", engineVersion: "1", checksum: "a".repeat(64), reviewed: false };
    expect(sourceBlockSchema.safeParse({ ...base, page: 0 }).success).toBe(false);
    expect(sourceBlockSchema.safeParse({ ...base, confidence: 1.1 }).success).toBe(false);
    expect(sourceBlockSchema.safeParse({ ...base, boundingBox: { x: 0, y: 0, width: 101, height: 1 } }).success).toBe(false);
    expect(sourceBlockSchema.safeParse({ ...base, timeStartMs: 2_000, timeEndMs: 1_000, page: undefined }).success).toBe(false);
  });

  it("requires asset descriptors and extraction metrics to be bounded", () => {
    expect(assetDescriptorSchema.safeParse({ id: "a1", filename: "x.pdf", mimeType: "application/pdf", byteCount: 1, checksum: "a".repeat(64) }).success).toBe(true);
    expect(assetDescriptorSchema.safeParse({ id: "a1", filename: "x.pdf", mimeType: "application/pdf", byteCount: -1, checksum: "bad" }).success).toBe(false);
    expect(extractionMetricsSchema.safeParse({ pageCount: 2, blockCount: 3, extractedChars: 10, durationMs: 20, truncated: false }).success).toBe(true);
    expect(extractionMetricsSchema.safeParse({ pageCount: 2, blockCount: 3, extractedChars: 10, durationMs: 20, truncated: "yes" }).success).toBe(false);
    expect(extractionRunResultSchema.safeParse({ status: "SUCCEEDED", requestedMode: "LOCAL_PREFERRED", effectiveMode: "LOCAL_ONLY", metrics: { pageCount: 1, blockCount: 1, extractedChars: 1, durationMs: 1, truncated: false } }).success).toBe(true);
  });

  it("keeps extraction status and error code semantically coherent", () => {
    const base = {
      requestedMode: "LOCAL_PREFERRED" as const,
      effectiveMode: "LOCAL_ONLY" as const,
      metrics: { pageCount: 1, blockCount: 1, extractedChars: 1, durationMs: 1, truncated: false },
    };
    expect(extractionRunResultSchema.safeParse({ ...base, status: "SUCCEEDED", errorCode: "CLOUD_FAILED" }).success).toBe(false);
    expect(extractionRunResultSchema.safeParse({ ...base, status: "FAILED" }).success).toBe(false);
    expect(extractionRunResultSchema.safeParse({ ...base, status: "FAILED", errorCode: "LOCAL_FAILED" }).success).toBe(true);
  });

  it("does not allow local-only requests to report cloud-quality processing", () => {
    const result = {
      status: "SUCCEEDED" as const,
      requestedMode: "LOCAL_ONLY" as const,
      effectiveMode: "CLOUD_QUALITY" as const,
      metrics: { pageCount: 1, blockCount: 1, extractedChars: 1, durationMs: 1, truncated: false },
    };
    expect(extractionRunResultSchema.safeParse(result).success).toBe(false);
    expect(extractionRunResultSchema.safeParse({ ...result, effectiveMode: "LOCAL_ONLY" }).success).toBe(true);
    expect(extractionRunResultSchema.safeParse({ ...result, requestedMode: "LOCAL_PREFERRED" }).success).toBe(true);
  });

  it("enforces the complete requested and effective processing mode map", () => {
    const base = {
      status: "SUCCEEDED" as const,
      metrics: { pageCount: 1, blockCount: 1, extractedChars: 1, durationMs: 1, truncated: false },
    };
    const isValid = (requestedMode: "LOCAL_ONLY" | "LOCAL_PREFERRED" | "CLOUD_QUALITY", effectiveMode: "LOCAL_ONLY" | "LOCAL_PREFERRED" | "CLOUD_QUALITY") =>
      extractionRunResultSchema.safeParse({ ...base, requestedMode, effectiveMode }).success;

    expect(isValid("LOCAL_ONLY", "LOCAL_ONLY")).toBe(true);
    expect(isValid("LOCAL_PREFERRED", "LOCAL_ONLY")).toBe(true);
    expect(isValid("LOCAL_PREFERRED", "CLOUD_QUALITY")).toBe(true);
    expect(isValid("CLOUD_QUALITY", "CLOUD_QUALITY")).toBe(true);
    expect(isValid("LOCAL_PREFERRED", "LOCAL_PREFERRED")).toBe(false);
    expect(isValid("CLOUD_QUALITY", "LOCAL_ONLY")).toBe(false);
    expect(isValid("CLOUD_QUALITY", "LOCAL_PREFERRED")).toBe(false);
  });

  it("serializes bounded source blocks without raw binary fields", () => {
    const block = sourceBlockSchema.parse({ id: "b1", assetId: "a1", kind: "IMAGE_CAPTION", text: "caption", page: 1,
      confidence: 0.8, engine: "ocr", engineVersion: "1", checksum: "b".repeat(64), reviewed: true });
    const json = serializeSourceBlock(block);
    expect(sourceBlockJsonSchema.parse(json)).toEqual(json);
    expect(json).not.toHaveProperty("data");
    expect(JSON.stringify(json)).not.toMatch(/base64|rawBinary|ArrayBuffer/i);
  });

  it("requires exact consent purpose, checksum, expiry, and decision", () => {
    const consent = { actorId: "u1", assetChecksum: "a".repeat(64), provider: "zai", purpose: "quality extraction",
      expiresAt: new Date("2026-09-01T00:00:00.000Z"), decision: "APPROVED" };
    expect(processingConsentSchema.parse(consent)).toMatchObject(consent);
    expect(processingConsentSchema.safeParse({ ...consent, purpose: "" }).success).toBe(false);
    expect(processingConsentSchema.safeParse({ ...consent, decision: "" }).success).toBe(false);
  });
});
