import { createHash, timingSafeEqual } from "node:crypto";

export type ResetTokenCandidate = {
    token: string;
    tokenHash?: string | null;
};

export type ResetTokenMatch = "hashed" | "legacy" | null;

/** Return the SHA-256 hex digest used for persisted reset tokens. */
export function hashAuthToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Compare strings through fixed-size digests and a timing-safe equality check. */
export function constantTimeEqual(left: string, right: string): boolean {
    const leftDigest = createHash("sha256").update(left, "utf8").digest();
    const rightDigest = createHash("sha256").update(right, "utf8").digest();
    return timingSafeEqual(leftDigest, rightDigest);
}

/**
 * Match a reset token with the hashed representation first.
 * Rows without tokenHash are legacy rows and may use the plaintext fallback.
 */
export function matchResetToken(
    candidate: ResetTokenCandidate,
    token: string
): ResetTokenMatch {
    const tokenHash = hashAuthToken(token);

    if (candidate.tokenHash !== null && candidate.tokenHash !== undefined) {
        return constantTimeEqual(candidate.tokenHash, tokenHash) ? "hashed" : null;
    }

    return constantTimeEqual(candidate.token, token) ? "legacy" : null;
}
