import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    LOCAL_MODEL_MANIFEST,
    ModelManifestUnavailableError,
    loadVerifiedModelAsset,
    validateModelAsset,
} from "./model-manifest";

describe("Sabah local model manifest", () => {
    it("exports the required pinned model identifiers without inventing deployment metadata", () => {
        expect(Object.keys(LOCAL_MODEL_MANIFEST)).toEqual([
            "tesseract-ara",
            "tesseract-eng",
            "whispercpp-wasm",
            "whisper-multilingual",
        ]);
        expect(Object.values(LOCAL_MODEL_MANIFEST).every((asset) => asset === undefined)).toBe(true);
    });

    it("requires HTTPS, positive bytes, sha256, license, and version for a published asset", () => {
        const valid = {
            id: "fixture",
            url: "https://models.example.test/fixture.bin",
            bytes: 3,
            sha256: createHash("sha256").update("abc").digest("hex"),
            version: "fixture-1",
            license: "MIT",
        } as const;
        expect(validateModelAsset(valid)).toEqual(valid);
        expect(() => validateModelAsset({ ...valid, url: "http://models.example.test/fixture.bin" })).toThrow();
        expect(() => validateModelAsset({ ...valid, bytes: 0 })).toThrow();
        expect(() => validateModelAsset({ ...valid, sha256: "not-a-hash" })).toThrow();
        expect(() => validateModelAsset({ ...valid, version: "" })).toThrow();
        expect(() => validateModelAsset({ ...valid, license: "" })).toThrow();
    });

    it("fails closed when generated deployment metadata is absent", async () => {
        await expect(loadVerifiedModelAsset(undefined, new Map())).rejects.toBeInstanceOf(ModelManifestUnavailableError);
    });

    it("verifies bytes and sha256 before caching a fetched asset", async () => {
        const body = new TextEncoder().encode("abc");
        const asset = validateModelAsset({
            id: "fixture",
            url: "https://models.example.test/fixture.bin",
            bytes: body.byteLength,
            sha256: createHash("sha256").update(body).digest("hex"),
            version: "fixture-1",
            license: "MIT",
        });
        const cache = new Map<string, Uint8Array>();
        const result = await loadVerifiedModelAsset(asset, cache, async () => new Response(body));
        expect(result).toEqual(body);
        expect(cache.get("fixture@fixture-1")).toEqual(body);
    });

    it("deletes a mismatched cached asset and rejects it", async () => {
        const asset = validateModelAsset({
            id: "fixture",
            url: "https://models.example.test/fixture.bin",
            bytes: 3,
            sha256: createHash("sha256").update("abc").digest("hex"),
            version: "fixture-1",
            license: "MIT",
        });
        const cache = new Map<string, Uint8Array>([["fixture@fixture-1", new TextEncoder().encode("bad")]]);
        await expect(loadVerifiedModelAsset(asset, cache, async () => new Response("bad"))).rejects.toThrow(/integrity/i);
        expect(cache.has("fixture@fixture-1")).toBe(false);
    });
});
