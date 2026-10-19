import { AI_RATE_LIMIT, checkRateLimit as checkDatabaseRateLimit } from "@/lib/rate-limit";

export type RateLimitResult = {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    retryAfterSec: number;
};

/** Compatibility adapter for AI routes while they migrate to the shared store. */
export async function checkRateLimit(userId: string): Promise<RateLimitResult> {
    const result = await checkDatabaseRateLimit(
        `ai:${userId}`,
        AI_RATE_LIMIT.limit,
        AI_RATE_LIMIT.windowSec,
    );
    return {
        ...result,
        resetAt: Date.now() + result.retryAfterSec * 1000,
    };
}

export const MAX_TOOL_CALLS_PER_MESSAGE = 25;
export const MAX_LOOP_ITERATIONS = 15;
export const MAX_CONTEXT_CHARS = 48_000;
