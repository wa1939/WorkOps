export type TemporaryAssetStore = {
  put(key: string, body: Uint8Array, expiresAt: Date): Promise<{ key: string; expiresAt: Date }>;
  getSignedReadUrl(key: string, expiresAt: Date): Promise<string>;
  delete(key: string): Promise<void>;
};

export const TEMPORARY_ASSET_PREFIX = "temporary/";
export const MAX_STORAGE_KEY_LENGTH = 200;

export function validateTemporaryKey(key: string): string {
  if (key.length === 0 || key.length > MAX_STORAGE_KEY_LENGTH || !key.startsWith(TEMPORARY_ASSET_PREFIX)
    || key.includes("..") || key.includes("\\") || !/^temporary\/[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error("INVALID_TEMPORARY_KEY");
  }
  return key;
}
