import { MAX_STORAGE_KEY_LENGTH, TEMPORARY_ASSET_PREFIX, TemporaryAssetStore, validateTemporaryKey } from "./contracts";

type PrivateBlobClient = {
  put(path: string, body: Uint8Array, options: { access: "private"; addRandomSuffix: false; cacheControlMaxAge: number }): Promise<unknown>;
  getSignedUrl(path: string, options: { expiresAt: Date }): Promise<string>;
  del(path: string): Promise<void>;
};

export type VercelBlobAdapterOptions = { client: PrivateBlobClient; temporaryTtlMs?: number; now?: () => number };

export function createVercelBlobTemporaryStore(options: VercelBlobAdapterOptions): TemporaryAssetStore {
  const ttl = options.temporaryTtlMs ?? 15 * 60 * 1000;
  const now = options.now ?? (() => Date.now());
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 24 * 60 * 60 * 1000) throw new Error("INVALID_TEMPORARY_TTL");
  return {
    async put(key, body, expiresAt) {
      validateTemporaryKey(key);
      if (!(expiresAt instanceof Date) || expiresAt.getTime() <= now() || expiresAt.getTime() > now() + ttl || body.byteLength > 50_000_000) throw new Error("INVALID_TEMPORARY_ASSET");
      await options.client.put(key, body, { access: "private", addRandomSuffix: false, cacheControlMaxAge: Math.ceil(ttl / 1000) });
      return { key, expiresAt };
    },
    async getSignedReadUrl(key, expiresAt) {
      validateTemporaryKey(key);
      if (!(expiresAt instanceof Date) || expiresAt.getTime() <= now() || expiresAt.getTime() > now() + ttl) throw new Error("EXPIRED_TEMPORARY_ASSET");
      return options.client.getSignedUrl(key, { expiresAt });
    },
    async delete(key) { validateTemporaryKey(key); await options.client.del(key); },
  };
}

export function temporaryKey(assetId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(assetId)) throw new Error("INVALID_TEMPORARY_KEY");
  const key = `${TEMPORARY_ASSET_PREFIX}${assetId}`;
  if (key.length > MAX_STORAGE_KEY_LENGTH) throw new Error("INVALID_TEMPORARY_KEY");
  return key;
}
