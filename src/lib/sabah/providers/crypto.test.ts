import { describe, it, expect } from "vitest";
import { encryptCredential, decryptCredential } from "./crypto";

describe("encryptCredential", () => {
    it("round-trips a credential without persisting plaintext", () => {
        const masterKey = Buffer.from("a".repeat(32), "utf8").toString("base64");
        const secret = "my-secret-api-key-12345";

        const encrypted = encryptCredential(secret, masterKey, { keyVersion: 1 });

        // Encrypted blob should NOT contain the plaintext secret
        expect(JSON.stringify(encrypted)).not.toContain(secret);
        expect(JSON.stringify(encrypted)).not.toContain("secret-api-key");

        // Decrypt should recover the original
        const decrypted = decryptCredential(encrypted, masterKey);
        expect(decrypted).toBe(secret);
    });

    it("fails with wrong master key", () => {
        const masterKey1 = Buffer.from("a".repeat(32), "utf8").toString("base64");
        const masterKey2 = Buffer.from("b".repeat(32), "utf8").toString("base64");
        const secret = "my-secret-api-key-12345";

        const encrypted = encryptCredential(secret, masterKey1, { keyVersion: 1 });

        // Decrypting with wrong key should fail
        expect(() => decryptCredential(encrypted, masterKey2)).toThrow();
    });

    it("supports keyVersion for rotation", () => {
        const masterKey1 = Buffer.from("a".repeat(32), "utf8").toString("base64");
        const secret = "my-secret-api-key-12345";

        const encryptedV1 = encryptCredential(secret, masterKey1, { keyVersion: 1 });
        expect(encryptedV1.keyVersion).toBe(1);

        // Decrypt with same key version should work
        const decrypted = decryptCredential(encryptedV1, masterKey1);
        expect(decrypted).toBe(secret);
    });

    it("generates unique IV for each encryption", () => {
        const masterKey = Buffer.from("a".repeat(32), "utf8").toString("base64");
        const secret = "same-secret";

        const encrypted1 = encryptCredential(secret, masterKey, { keyVersion: 1 });
        const encrypted2 = encryptCredential(secret, masterKey, { keyVersion: 1 });

        // IVs should be different (random)
        expect(encrypted1.iv).not.toBe(encrypted2.iv);
        expect(encrypted1.encryptedValue).not.toBe(encrypted2.encryptedValue);

        // Both should decrypt to same secret
        expect(decryptCredential(encrypted1, masterKey)).toBe(secret);
        expect(decryptCredential(encrypted2, masterKey)).toBe(secret);
    });

    it("uses SABAH_CREDENTIAL_KEY env var when masterKey not provided", () => {
        const secret = "env-secret-key";
        const envKey = Buffer.from("c".repeat(32), "utf8").toString("base64");

        process.env.SABAH_CREDENTIAL_KEY = envKey;

        const encrypted = encryptCredential(secret);
        expect(JSON.stringify(encrypted)).not.toContain(secret);

        const decrypted = decryptCredential(encrypted);
        expect(decrypted).toBe(secret);

        delete process.env.SABAH_CREDENTIAL_KEY;
    });
});
