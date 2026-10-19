export const MODEL_ASSET_IDS = [
    "tesseract-ara",
    "tesseract-eng",
    "whispercpp-wasm",
    "whisper-multilingual",
] as const;

export type ModelAssetId = (typeof MODEL_ASSET_IDS)[number];

export type VerifiedModelAsset = {
    readonly id: ModelAssetId | "fixture";
    readonly url: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly version: string;
    readonly license: string;
};

export type GeneratedModelManifest = Readonly<Partial<Record<ModelAssetId, VerifiedModelAsset>>>;

/**
 * Generated deployment boundary. Asset publication is deliberately separate
 * from source control; absent entries must remain unavailable at runtime.
 */
export const LOCAL_MODEL_MANIFEST: GeneratedModelManifest = {
    "tesseract-ara": undefined,
    "tesseract-eng": undefined,
    "whispercpp-wasm": undefined,
    "whisper-multilingual": undefined,
};

export class ModelManifestUnavailableError extends Error {
    public readonly code = "MODEL_MANIFEST_UNAVAILABLE" as const;

    public constructor(id: string) {
        super(`No verified deployment manifest entry is available for ${id}`);
        this.name = "ModelManifestUnavailableError";
    }
}

export class ModelAssetIntegrityError extends Error {
    public readonly code = "MODEL_ASSET_INTEGRITY_FAILED" as const;

    public constructor(message: string) {
        super(message);
        this.name = "ModelAssetIntegrityError";
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export function validateModelAsset(value: unknown): VerifiedModelAsset {
    if (!isRecord(value)
        || typeof value.id !== "string"
        || typeof value.url !== "string"
        || !/^https:\/\//.test(value.url)
        || typeof value.bytes !== "number"
        || !Number.isSafeInteger(value.bytes)
        || value.bytes <= 0
        || typeof value.sha256 !== "string"
        || !/^[a-f0-9]{64}$/.test(value.sha256)
        || typeof value.version !== "string"
        || value.version.length === 0
        || typeof value.license !== "string"
        || value.license.length === 0) {
        throw new ModelAssetIntegrityError("Model manifest entry is invalid");
    }
    return value as VerifiedModelAsset;
}

type ModelAssetCache = Map<string, Uint8Array>;
type FetchAsset = (url: string, init?: RequestInit) => Promise<Response>;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cacheKey(asset: VerifiedModelAsset): string {
    return `${asset.id}@${asset.version}`;
}

async function verifyBytes(asset: VerifiedModelAsset, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength !== asset.bytes || (await sha256Hex(bytes)) !== asset.sha256) {
        throw new ModelAssetIntegrityError(`Integrity verification failed for ${asset.id}`);
    }
}

export async function loadVerifiedModelAsset(
    entry: VerifiedModelAsset | undefined,
    cache: ModelAssetCache,
    fetchAsset: FetchAsset = (url, init) => fetch(url, init),
    signal?: AbortSignal,
): Promise<Uint8Array> {
    if (entry === undefined) {
        throw new ModelManifestUnavailableError("requested asset");
    }
    const asset = validateModelAsset(entry);
    const key = cacheKey(asset);
    const cached = cache.get(key);
    if (cached !== undefined) {
        try {
            await verifyBytes(asset, cached);
            return cached;
        } catch {
            cache.delete(key);
            throw new ModelAssetIntegrityError(`Cached asset failed integrity verification for ${asset.id}`);
        }
    }

    const response = await fetchAsset(asset.url, { signal });
    if (!response.ok) {
        throw new Error(`Model asset request failed with HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    await verifyBytes(asset, bytes);
    cache.set(key, bytes);
    return bytes;
}
