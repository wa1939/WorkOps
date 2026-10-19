import { describe, expect, it, beforeEach } from "vitest";
import { redactSabahPayload } from "./redact";

describe("redactSabahPayload", () => {
    it("redacts nested credentials and bounds strings/arrays", () => {
        expect(redactSabahPayload({
            apiKey: "secret-key-123",
            authorization: "Bearer secret",
            body: "x".repeat(5000),
            items: Array.from({ length: 200 }, (_, id) => ({ id })),
        })).toEqual({
            apiKey: "[REDACTED]",
            authorization: "[REDACTED]",
            body: expect.stringMatching(/\[TRUNCATED\]$/),
            items: expect.arrayContaining([{ id: 0 }]),
        });
    });

    it("redacts credential-like keys at any level", () => {
        expect(redactSabahPayload({
            headers: {
                "x-api-key": "secret",
                cookie: "session=abc123",
            },
            config: {
                password: "hunter2",
                token: "jwt-token",
                secret: "api-secret",
            },
        })).toEqual({
            headers: {
                "x-api-key": "[REDACTED]",
                cookie: "[REDACTED]",
            },
            config: {
                password: "[REDACTED]",
                token: "[REDACTED]",
                secret: "[REDACTED]",
            },
        });
    });

    it("truncates long strings with [TRUNCATED] suffix", () => {
        const longString = "a".repeat(1001);
        expect(redactSabahPayload(longString)).toEqual(expect.stringMatching(/^a+\[TRUNCATED\]$/));
    });

    it("bounds arrays to maximum length", () => {
        const longArray = Array.from({ length: 101 }, (_, i) => i);
        const result = redactSabahPayload(longArray) as unknown[];
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeLessThanOrEqual(100);
        expect(result).toContain(0);
    });

    it("handles circular references gracefully", () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        const result = redactSabahPayload(circular) as Record<string, unknown>;
        expect(result).toBeDefined();
        expect(result.self).toBe("[CIRCULAR]");
    });

    it("converts Error to string representation", () => {
        const error = new Error("Something went wrong");
        const result = redactSabahPayload(error) as string;
        expect(typeof result).toBe("string");
        expect(result).toContain("Error: Something went wrong");
    });

    it("converts Date to ISO string", () => {
        const date = new Date("2024-01-15T10:30:00Z");
        const result = redactSabahPayload(date);
        expect(result).toBe("2024-01-15T10:30:00.000Z");
    });

    it("handles binary buffers safely", () => {
        const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
        const result = redactSabahPayload(buffer);
        expect(result).toBe("[BINARY]");
    });

    it("respects maximum depth and stops recursion", () => {
        const deep: Record<string, unknown> = { level: 1 };
        let current = deep;
        for (let i = 2; i <= 12; i++) {
            current.next = { level: i };
            current = current.next as Record<string, unknown>;
        }
        const result = redactSabahPayload(deep) as Record<string, unknown>;
        expect(result.level).toBe(1);
        expect(result.next).toBeDefined();
    });

    it("preserves simple primitives unchanged", () => {
        expect(redactSabahPayload(42)).toBe(42);
        expect(redactSabahPayload(null)).toBe(null);
        expect(redactSabahPayload(undefined)).toBe(undefined);
        expect(redactSabahPayload(true)).toBe(true);
        expect(redactSabahPayload("short")).toBe("short");
    });

    it("handles empty objects and arrays", () => {
        expect(redactSabahPayload({})).toEqual({});
        expect(redactSabahPayload([])).toEqual([]);
    });
});
