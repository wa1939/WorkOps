import { createHash } from "node:crypto";
import {
    decryptCredential,
    encryptCredential,
    type EncryptedCredential,
} from "../sabah/providers/crypto";

const PURPOSE = "push-sub";
const EXPECTED_KEY_BYTES = 32;

type StoredPushValue = EncryptedCredential & { purpose: typeof PURPOSE };

/**
 * Push values use PWA_SUBSCRIPTION_KEY when configured and temporarily fall
 * back to SABAH_CREDENTIAL_KEY for deployments that share the existing
 * base64-encoded 32-byte secret. The purpose-derived key keeps push data from
 * being encrypted directly with Sabah's credential key and permits a later
 * independent PWA key rollout without changing the database envelope.
 */
function purposeKey(masterKey?: string): string {
    const configuredKey = masterKey || process.env.PWA_SUBSCRIPTION_KEY || process.env.SABAH_CREDENTIAL_KEY;
    if (!configuredKey) {
        throw new Error("PWA_SUBSCRIPTION_KEY or SABAH_CREDENTIAL_KEY must be configured");
    }

    const rawKey = Buffer.from(configuredKey, "base64");
    if (rawKey.length !== EXPECTED_KEY_BYTES) {
        throw new Error(`Push subscription key must be 32 bytes (base64), got ${rawKey.length}`);
    }

    return createHash("sha256")
        .update(`${PURPOSE}:`, "utf8")
        .update(rawKey)
        .digest("base64");
}

/** Encrypt one push subscription value into a database-safe string. */
export function encryptPushSubscriptionValue(value: string, masterKey?: string): string {
    const encrypted = encryptCredential(value, purposeKey(masterKey));
    const envelope: StoredPushValue = { ...encrypted, purpose: PURPOSE };
    return JSON.stringify(envelope);
}

function parseEnvelope(serialized: string): StoredPushValue {
    let parsed: unknown;
    try {
        parsed = JSON.parse(serialized);
    } catch {
        throw new Error("Invalid encrypted push subscription value");
    }

    if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid encrypted push subscription value");
    }

    const value = parsed as Partial<StoredPushValue>;
    if (
        value.purpose !== PURPOSE
        || typeof value.encryptedValue !== "string"
        || typeof value.iv !== "string"
        || typeof value.authTag !== "string"
        || typeof value.keyVersion !== "number"
    ) {
        throw new Error("Invalid encrypted push subscription value");
    }

    return value as StoredPushValue;
}

/** Decrypt a value created by encryptPushSubscriptionValue. */
export function decryptPushSubscriptionValue(serialized: string, masterKey?: string): string {
    const envelope = parseEnvelope(serialized);
    return decryptCredential(envelope, purposeKey(masterKey));
}
