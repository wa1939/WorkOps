export type RateLimitEntry = {
    key?: string;
    windowStart: Date;
    count: number;
};

export type RateLimitDecision = {
    allowed: boolean;
    retryAfterSec: number;
    remaining: number;
};

export type RateLimitClock = Date | number;

function timestampMs(value: RateLimitClock): number {
    const timestamp = value instanceof Date ? value.getTime() : value;
    if (!Number.isFinite(timestamp)) {
        throw new RangeError("Rate-limit clock must be a valid date");
    }
    return timestamp;
}

function validateWindow(limit: number, windowSec: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new RangeError("Rate-limit limit must be a positive integer");
    }
    if (!Number.isFinite(windowSec) || windowSec <= 0) {
        throw new RangeError("Rate-limit window must be positive");
    }
}

export function getWindowStart(now: RateLimitClock, windowSec: number): Date {
    const nowMs = timestampMs(now);
    if (!Number.isFinite(windowSec) || windowSec <= 0) {
        throw new RangeError("Rate-limit window must be positive");
    }
    const windowMs = windowSec * 1000;
    return new Date(Math.floor(nowMs / windowMs) * windowMs);
}

/**
 * Decide whether one request may consume a slot in the current fixed window.
 * The entries are expected to already be scoped to one rate-limit key.
 */
export function decideRateLimit(
    entries: readonly RateLimitEntry[],
    now: RateLimitClock,
    limit: number,
    windowSec: number,
): RateLimitDecision {
    validateWindow(limit, windowSec);
    const nowMs = timestampMs(now);
    const windowMs = windowSec * 1000;
    const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
    const currentCount = entries.reduce((total, entry) => {
        if (entry.windowStart.getTime() !== windowStartMs || !Number.isFinite(entry.count)) return total;
        return total + Math.max(0, Math.floor(entry.count));
    }, 0);
    const allowed = currentCount < limit;

    return {
        allowed,
        retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1000)),
        remaining: Math.max(0, limit - currentCount - (allowed ? 1 : 0)),
    };
}
