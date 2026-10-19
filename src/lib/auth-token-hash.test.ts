import { describe, expect, it } from "vitest";
import {
    constantTimeEqual,
    hashAuthToken,
    matchResetToken,
} from "./auth-token-hash";
import { isPasswordVersionCurrent } from "./auth-session";

describe("auth token hashing", () => {
    it("returns a deterministic SHA-256 hex digest", () => {
        expect(hashAuthToken("abc")).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        expect(hashAuthToken("abc")).toMatch(/^[a-f0-9]{64}$/);
    });

    it("compares values without leaking the value length", () => {
        expect(constantTimeEqual("same-token", "same-token")).toBe(true);
        expect(constantTimeEqual("same-token", "different-token")).toBe(false);
        expect(constantTimeEqual("same-token", "same-token-with-extra")).toBe(false);
    });

    it("uses the hash match before the legacy plaintext fallback", () => {
        const token = "reset-token";

        expect(
            matchResetToken({ token: "legacy-value", tokenHash: hashAuthToken(token) }, token)
        ).toBe("hashed");
        expect(matchResetToken({ token, tokenHash: null }, token)).toBe("legacy");
        expect(matchResetToken({ token, tokenHash: undefined }, token)).toBe("legacy");
        expect(
            matchResetToken({ token, tokenHash: hashAuthToken("another-token") }, token)
        ).toBe(null);
        expect(matchResetToken({ token, tokenHash: null }, "wrong-token")).toBe(null);
    });
});

describe("password version revocation", () => {
    it("accepts only an equal non-negative integer version", () => {
        expect(isPasswordVersionCurrent(0, 0)).toBe(true);
        expect(isPasswordVersionCurrent(3, 3)).toBe(true);
        expect(isPasswordVersionCurrent(2, 3)).toBe(false);
        expect(isPasswordVersionCurrent(undefined, 0)).toBe(false);
        expect(isPasswordVersionCurrent("0", 0)).toBe(false);
        expect(isPasswordVersionCurrent(-1, -1)).toBe(false);
    });
});
