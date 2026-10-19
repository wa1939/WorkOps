import { describe, expect, it } from "vitest";
import { assertCloudConsent, createProcessingConsent, ConsentError } from "./consent";
import { createVercelBlobTemporaryStore } from "./storage/vercel-blob";

const constChecksum: string = "a".repeat(64);
const approved = (overrides: Record<string, unknown> = {}) => createProcessingConsent({
  actorId: "actor-1", assetChecksum: constChecksum, provider: "zai", purpose: "quality extraction",
  expiresAt: new Date("2030-01-01T00:00:00Z"), decision: "APPROVED", ...overrides,
});

describe("explicit cloud processing consent", () => {
  it("binds actor, checksum, provider, purpose, expiry, and decision", () => {
    expect(approved()).toMatchObject({ actorId: "actor-1", assetChecksum: constChecksum, provider: "zai", purpose: "quality extraction", decision: "APPROVED" });
  });

  it("fails closed for local-only mode, missing or denied consent", () => {
    expect(() => assertCloudConsent("LOCAL_ONLY", undefined, { actorId: "actor-1", assetChecksum: constChecksum, provider: "zai", purpose: "quality extraction" })).toThrowError(ConsentError);
    expect(() => assertCloudConsent("CLOUD_QUALITY", undefined, { actorId: "actor-1", assetChecksum: constChecksum, provider: "zai", purpose: "quality extraction" })).toThrow(/CONSENT_REQUIRED/);
    expect(() => assertCloudConsent("CLOUD_QUALITY", approved({ decision: "DENIED" }), { actorId: "actor-1", assetChecksum: constChecksum, provider: "zai", purpose: "quality extraction" })).toThrow(/CONSENT_DENIED/);
  });

  it("rejects expired and mismatched consent", () => {
    const request = { actorId: "actor-1", assetChecksum: constChecksum, provider: "zai", purpose: "quality extraction" };
    expect(() => assertCloudConsent("CLOUD_QUALITY", approved({ expiresAt: new Date("2020-01-01") }), request, new Date("2025-01-01"))).toThrow(/CONSENT_EXPIRED/);
    expect(() => assertCloudConsent("CLOUD_QUALITY", approved(), { ...request, provider: "other" })).toThrow(/CONSENT_MISMATCH/);
    expect(() => assertCloudConsent("CLOUD_QUALITY", approved(), { ...request, purpose: "training" })).toThrow(/CONSENT_MISMATCH/);
    expect(() => assertCloudConsent("CLOUD_QUALITY", approved(), { ...request, assetChecksum: "b".repeat(64) })).toThrow(/CONSENT_MISMATCH/);
  });
});

describe("temporary blob expiry bounds", () => {
  it("rejects put and signed URL expiries beyond the configured TTL", async () => {
    const client = { put: async () => undefined, getSignedUrl: async () => "signed", del: async () => undefined };
    const now = Date.now();
    const store = createVercelBlobTemporaryStore({ client, temporaryTtlMs: 900_000, now: () => now });
    await expect(store.put("temporary/asset", new Uint8Array([1]), new Date(now + 900_001))).rejects.toThrow("INVALID_TEMPORARY_ASSET");
    await expect(store.getSignedReadUrl("temporary/asset", new Date(now + 900_001))).rejects.toThrow("EXPIRED_TEMPORARY_ASSET");
  });
});
