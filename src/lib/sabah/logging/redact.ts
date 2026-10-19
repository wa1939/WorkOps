type RedactionLimits = {
    maxStringLength: number;
    maxArrayLength: number;
    maxDepth: number;
};

const DEFAULT_LIMITS: RedactionLimits = {
    maxStringLength: 1000,
    maxArrayLength: 100,
    maxDepth: 10,
};

const CREDENTIAL_KEYS = [
    "password",
    "token",
    "secret",
    "apikey",
    "api-key",
    "api_key",
    "authorization",
    "cookie",
    "credential",
    "key",
];

function isCredentialKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return CREDENTIAL_KEYS.some((ck) => lowerKey.includes(ck));
}

function isBinary(value: unknown): boolean {
    return (
        typeof Buffer !== "undefined" &&
        (value instanceof Buffer ||
            (typeof value === "object" && value !== null && (value as Record<string, unknown>).constructor?.name === "Buffer"))
    );
}

function redactValue(
    value: unknown,
    limits: RedactionLimits,
    depth: number,
    seen: Set<unknown>,
): unknown {
    // Max depth exceeded
    if (depth > limits.maxDepth) {
        return "[MAX_DEPTH]";
    }

    // Circular reference detection
    if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
            return "[CIRCULAR]";
        }
        seen.add(value);
    }

    // Primitive types (return as-is)
    if (value === null || value === undefined) {
        return value;
    }

    // Boolean and number
    if (typeof value === "boolean" || typeof value === "number") {
        return value;
    }

    // String (truncate if too long)
    if (typeof value === "string") {
        if (value.length > limits.maxStringLength) {
            return value.slice(0, limits.maxStringLength) + "[TRUNCATED]";
        }
        return value;
    }

    // Error objects (convert to string)
    if (value instanceof Error) {
        return `[Error: ${value.message}]`;
    }

    // Date objects (convert to ISO string)
    if (value instanceof Date) {
        return value.toISOString();
    }

    // Binary buffers
    if (isBinary(value)) {
        return "[BINARY]";
    }

    // Arrays
    if (Array.isArray(value)) {
        const boundedArray = value.slice(0, limits.maxArrayLength);
        return boundedArray.map((item) => redactValue(item, limits, depth + 1, new Set(seen)));
    }

    // Plain objects
    if (typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value)) {
            if (isCredentialKey(key)) {
                result[key] = "[REDACTED]";
            } else {
                result[key] = redactValue(val, limits, depth + 1, new Set(seen));
            }
        }
        return result;
    }

    // Fallback for unknown types
    return String(value);
}

/**
 * Redacts sensitive information from Sabah payloads.
 *
 * - Credential-like keys (password, token, secret, apiKey, etc.) are replaced with [REDACTED]
 * - Strings longer than maxStringLength are truncated with [TRUNCATED] suffix
 * - Arrays longer than maxArrayLength are bounded
 * - Circular references are replaced with [CIRCULAR]
 * - Error objects are converted to string representation
 * - Date objects are converted to ISO strings
 * - Binary buffers are replaced with [BINARY]
 * - Recursion depth is limited to prevent stack overflow
 *
 * @param value - The value to redact
 * @param limits - Optional redaction limits (defaults: maxStringLength=1000, maxArrayLength=100, maxDepth=10)
 * @returns The redacted value
 */
export function redactSabahPayload(
    value: unknown,
    limits: Partial<RedactionLimits> = {},
): unknown {
    const mergedLimits: RedactionLimits = {
        ...DEFAULT_LIMITS,
        ...limits,
    };

    return redactValue(value, mergedLimits, 0, new Set());
}
