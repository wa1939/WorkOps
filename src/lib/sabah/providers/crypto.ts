import crypto from "node:crypto";

export interface EncryptedCredential {
    encryptedValue: string;
    iv: string;
    authTag: string;
    keyVersion: number;
}

/**
 * Encrypt a credential using AES-256-GCM.
 *
 * @param plaintext - The credential to encrypt (e.g., API key)
 * @param masterKey - Base64-encoded 32-byte key (or SABAH_CREDENTIAL_KEY env var)
 * @param options - Key version for rotation support
 * @returns Encrypted credential blob with IV, auth tag, and key version
 */
export function encryptCredential(
    plaintext: string,
    masterKey?: string,
    options: { keyVersion?: number } = {},
): EncryptedCredential {
    // Derive or use provided master key
    const key = masterKey ?? process.env.SABAH_CREDENTIAL_KEY;

    if (!key) {
        throw new Error("Master key not provided and SABAH_CREDENTIAL_KEY not set");
    }

    // Parse base64 key to buffer
    const keyBuffer = Buffer.from(key, "base64");

    if (keyBuffer.length !== 32) {
        throw new Error(`Master key must be 32 bytes (base64), got ${keyBuffer.length}`);
    }

    // Generate random IV (12 bytes is standard for GCM)
    const iv = crypto.randomBytes(12);

    // Create cipher
    const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);

    // Encrypt
    let encrypted = cipher.update(plaintext, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    // Get auth tag
    const authTag = cipher.getAuthTag();

    return {
        encryptedValue: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        keyVersion: options.keyVersion ?? 1,
    };
}

/**
 * Decrypt a credential using AES-256-GCM.
 *
 * @param encrypted - The encrypted credential blob
 * @param masterKey - Base64-encoded 32-byte key (or SABAH_CREDENTIAL_KEY env var)
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong key, corrupted data, etc.)
 */
export function decryptCredential(
    encrypted: EncryptedCredential,
    masterKey?: string,
): string {
    // Derive or use provided master key
    const key = masterKey ?? process.env.SABAH_CREDENTIAL_KEY;

    if (!key) {
        throw new Error("Master key not provided and SABAH_CREDENTIAL_KEY not set");
    }

    // Parse base64 key to buffer
    const keyBuffer = Buffer.from(key, "base64");

    if (keyBuffer.length !== 32) {
        throw new Error(`Master key must be 32 bytes (base64), got ${keyBuffer.length}`);
    }

    // Parse encrypted components
    const encryptedValue = Buffer.from(encrypted.encryptedValue, "base64");
    const iv = Buffer.from(encrypted.iv, "base64");
    const authTag = Buffer.from(encrypted.authTag, "base64");

    // Create decipher
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);

    // Set auth tag
    decipher.setAuthTag(authTag);

    // Decrypt
    let decrypted = decipher.update(encryptedValue);
    try {
        decrypted = Buffer.concat([decrypted, decipher.final()]);
    } catch (e) {
        throw new Error("Decryption failed: invalid key or corrupted data");
    }

    return decrypted.toString("utf8");
}
