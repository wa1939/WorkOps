import { describe, expect, it } from "vitest";
import { decideRateLimit } from "./core";

const windowSec = 15 * 60;
const windowStart = new Date("2026-09-13T12:00:00.000Z");

function entry(count: number, key = "account-a", start = windowStart) {
    return { key, windowStart: start, count };
}

describe("decideRateLimit", () => {
    it("starts a fresh window after the previous window rolls over", () => {
        const now = new Date("2026-09-13T12:15:00.000Z");

        expect(decideRateLimit([entry(5)], now, 5, windowSec)).toEqual({
            allowed: true,
            retryAfterSec: 0,
            remaining: 4,
        });
    });

    it("allows the request that reaches the limit and rejects the next one", () => {
        const now = new Date("2026-09-13T12:14:59.000Z");

        expect(decideRateLimit([entry(4)], now, 5, windowSec)).toEqual({
            allowed: true,
            retryAfterSec: 0,
            remaining: 0,
        });
        expect(decideRateLimit([entry(5)], now, 5, windowSec)).toEqual({
            allowed: false,
            retryAfterSec: 1,
            remaining: 0,
        });
    });

    it("does not share one key's count with another key", () => {
        const now = new Date("2026-09-13T12:05:00.000Z");

        expect(decideRateLimit([entry(5, "account-a")], now, 5, windowSec).allowed).toBe(false);
        expect(decideRateLimit([entry(0, "account-b")], now, 5, windowSec)).toEqual({
            allowed: true,
            retryAfterSec: 0,
            remaining: 4,
        });
    });

    it("computes retry-after as the ceiling to the current window's end", () => {
        const now = new Date("2026-09-13T12:14:31.000Z");

        expect(decideRateLimit([entry(5)], now, 5, windowSec).retryAfterSec).toBe(29);
    });
});
