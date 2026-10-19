import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";
import { MODEL_ASSET_IDS, type ModelAssetId, type VerifiedModelAsset } from "../src/lib/sabah/multimodal/model-manifest";

const usage = "Usage: tsx scripts/publish-sabah-model-assets.ts --output <manifest.json> --tesseract-ara <path> --tesseract-eng <path> --whispercpp-wasm <path> --whisper-multilingual <path>";

function argumentValue(args: readonly string[], name: string): string | undefined {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

function requiredEnvironment(name: string): string {
    const value = process.env[name];
    if (value === undefined || value.length === 0) {
        throw new Error(`${name} must be configured; credentials are never printed`);
    }
    return value;
}

export function validateModelAssetVersion(value: string | undefined): string {
    if (value === undefined || value.length === 0 || value.trim().length === 0) {
        throw new Error("SABAH_MODEL_ASSET_VERSION must be explicitly configured");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(value)) {
        throw new Error("SABAH_MODEL_ASSET_VERSION has an unsupported format");
    }
    return value;
}

function validateBucketConfiguration(): { access: "public" | "private"; prefix: string } {
    const access = requiredEnvironment("SABAH_MODEL_BUCKET_ACCESS");
    if (access !== "public" && access !== "private") {
        throw new Error("SABAH_MODEL_BUCKET_ACCESS must be public or private");
    }
    const prefix = requiredEnvironment("SABAH_MODEL_BUCKET_PREFIX");
    if (!/^[-a-zA-Z0-9_/]+$/.test(prefix)) {
        throw new Error("SABAH_MODEL_BUCKET_PREFIX contains unsupported characters");
    }
    requiredEnvironment("BLOB_READ_WRITE_TOKEN");
    return { access, prefix };
}

async function publishAsset(id: ModelAssetId, path: string, version: string, bucket: { access: "public" | "private"; prefix: string }): Promise<VerifiedModelAsset> {
    const bytes = await readFile(resolve(path));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const license = process.env[`SABAH_MODEL_LICENSE_${id.toUpperCase().replaceAll("-", "_")}`];
    if (license === undefined || license.length === 0) {
        throw new Error(`Missing license configuration for ${id}`);
    }
    const blob = await put(`${bucket.prefix}/${id}/${basename(path)}`, bytes, {
        access: bucket.access,
        addRandomSuffix: false,
        token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { id, url: blob.url, bytes: bytes.byteLength, sha256, version, license };
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const output = argumentValue(args, "--output");
    if (output === undefined) throw new Error(usage);
    const version = validateModelAssetVersion(process.env.SABAH_MODEL_ASSET_VERSION);
    const bucket = validateBucketConfiguration();
    const manifest: Partial<Record<ModelAssetId, VerifiedModelAsset>> = {};
    for (const id of MODEL_ASSET_IDS) {
        const path = argumentValue(args, `--${id}`);
        if (path === undefined) throw new Error(`Missing explicit artifact path for ${id}`);
        manifest[id] = await publishAsset(id, path, version, bucket);
    }
    await writeFile(resolve(output), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Asset publication failed";
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
    });
}
