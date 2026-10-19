import { decryptCredential, encryptCredential, type EncryptedCredential } from "../providers/crypto";
import { isValidConnectorKey } from "./registry";

export type ConnectorEncryptedCredential = EncryptedCredential & { connectorKey: string };
const MAX_PLAINTEXT = 16_384;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
function decode(value: unknown, min: number, max: number): boolean { if (typeof value !== "string" || !BASE64.test(value)) return false; const decoded = Buffer.from(value, "base64"); return decoded.length >= min && decoded.length <= max; }
function validateRecord(value: unknown): asserts value is ConnectorEncryptedCredential { if (!value || typeof value !== "object") throw new Error("Invalid encrypted credential"); const record = value as Partial<ConnectorEncryptedCredential>; if (!isValidConnectorKey(record.connectorKey) || !decode(record.encryptedValue, 1, MAX_PLAINTEXT) || !decode(record.iv, 12, 12) || !decode(record.authTag, 16, 16) || typeof record.keyVersion !== "number" || !Number.isInteger(record.keyVersion) || record.keyVersion < 0 || record.keyVersion > 1000) throw new Error("Invalid encrypted credential"); }
export function encryptConnectorCredential(plaintext: string, masterKey: string, options: { connectorKey: string; keyVersion?: number }): ConnectorEncryptedCredential {
  if (!isValidConnectorKey(options.connectorKey)) throw new Error("Invalid connector key");
  if (typeof plaintext !== "string" || plaintext.length > MAX_PLAINTEXT) throw new Error("Credential exceeds bounds");
  if (options.keyVersion !== undefined && (!Number.isInteger(options.keyVersion) || options.keyVersion < 0 || options.keyVersion > 1000)) throw new Error("Invalid key version");
  return { ...encryptCredential(plaintext, masterKey, { keyVersion: options.keyVersion }), connectorKey: options.connectorKey };
}
export function decryptConnectorCredential(value: ConnectorEncryptedCredential, masterKey: string): string {
  validateRecord(value);
  return decryptCredential(value, masterKey);
}
