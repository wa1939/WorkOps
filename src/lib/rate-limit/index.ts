import { prisma } from "@/lib/prisma";
import { decideRateLimit, getWindowStart, type RateLimitDecision } from "./core";

export const RATE_LIMIT_BUCKETS = {
    login: { limit: 5, windowSec: 15 * 60 },
    reset: { limit: 5, windowSec: 15 * 60 },
    ai: { limit: 20, windowSec: 60 * 60 },
    email: { limit: 10, windowSec: 60 * 60 },
} as const;

export const RATE_LIMITS = RATE_LIMIT_BUCKETS;
export const LOGIN_RATE_LIMIT = RATE_LIMIT_BUCKETS.login;
export const RESET_RATE_LIMIT = RATE_LIMIT_BUCKETS.reset;
export const RESET_IP_RATE_LIMIT = RATE_LIMIT_BUCKETS.reset;
export const AI_RATE_LIMIT = RATE_LIMIT_BUCKETS.ai;
export const EMAIL_RATE_LIMIT = RATE_LIMIT_BUCKETS.email;

const MAX_CONTENTION_RETRIES = 5;

type RateLimitEntryRecord = {
    key: string;
    windowStart: Date;
    count: number;
};

function isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: unknown }).code === "P2002";
}

function failOpen(now: Date, limit: number, windowSec: number): RateLimitDecision {
    const windowStart = getWindowStart(now, windowSec).getTime();
    const retryAfterSec = Math.max(1, Math.ceil((windowStart + windowSec * 1000 - now.getTime()) / 1000));
    return {
        allowed: true,
        // Do not advertise capacity while persistence is unavailable.
        remaining: 0,
        retryAfterSec,
    };
}

/**
 * Consume one slot from a database-backed fixed-window bucket.
 *
 * The compare-and-increment update makes the slot reservation atomic. A
 * concurrent first write is handled by retrying after the composite unique
 * constraint reports the row created by the other request.
 */
export async function checkRateLimit(
    key: string,
    limit: number,
    windowSec: number,
): Promise<RateLimitDecision> {
    const now = new Date();
    // Validate caller-supplied bucket settings before touching the database.
    decideRateLimit([], now, limit, windowSec);
    if (!key) throw new RangeError("Rate-limit key is required");

    const windowStart = getWindowStart(now, windowSec);

    try {
        for (let attempt = 0; attempt < MAX_CONTENTION_RETRIES; attempt += 1) {
            const existing = await prisma.rateLimitEntry.findUnique({
                where: {
                    key_windowStart: { key, windowStart },
                },
            }) as RateLimitEntryRecord | null;
            const decision = decideRateLimit(existing ? [existing] : [], now, limit, windowSec);
            if (!decision.allowed) return decision;

            if (!existing) {
                try {
                    await prisma.rateLimitEntry.create({
                        data: { key, windowStart, count: 1 },
                    });
                    return decision;
                } catch (error) {
                    if (!isUniqueConstraintError(error)) throw error;
                    continue;
                }
            }

            const updated = await prisma.rateLimitEntry.updateMany({
                where: { key, windowStart, count: existing.count },
                data: { count: { increment: 1 } },
            });
            if (updated.count === 1) return decision;
        }

        throw new Error("Rate-limit bucket contention exceeded retry budget");
    } catch (error) {
        console.error("[rate-limit] persistence unavailable; failing open", error);
        return failOpen(now, limit, windowSec);
    }
}

export type { RateLimitDecision } from "./core";
export { decideRateLimit, getWindowStart } from "./core";
