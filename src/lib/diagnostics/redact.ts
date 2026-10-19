export const MAX_DIAGNOSTIC_TEXT_LENGTH = 1_000;
export const MAX_DIAGNOSTIC_METADATA_BYTES = 16 * 1024;
export const MAX_DIAGNOSTIC_ARRAY_LENGTH = 50;
export const MAX_DIAGNOSTIC_OBJECT_KEYS = 50;
export const MAX_DIAGNOSTIC_DEPTH = 5;

type RedactionLimits = {
    maxStringLength: number;
    maxArrayLength: number;
    maxObjectKeys: number;
    maxDepth: number;
};

const DEFAULT_LIMITS: RedactionLimits = {
    maxStringLength: MAX_DIAGNOSTIC_TEXT_LENGTH,
    maxArrayLength: MAX_DIAGNOSTIC_ARRAY_LENGTH,
    maxObjectKeys: MAX_DIAGNOSTIC_OBJECT_KEYS,
    maxDepth: MAX_DIAGNOSTIC_DEPTH,
};

const REDACTED = "[REDACTED]";
const QUERY_REDACTED = "[QUERY_REDACTED]";
const OMITTED = "[OMITTED]";

// These keys are intentionally broader than credentials. Diagnostic records
// must describe behavior without becoming a second transcript or exposing
// provider reasoning/body payloads.
const SECRET_KEY_PATTERN = /(?:password|passwd|token|secret|api[-_]?key|authorization|cookie|credential|private[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret)/i;
const OMIT_KEY_PATTERN = /^(?:prompt|messages|reasoning|reasoning[_-]?content|raw[_-]?(?:body|response)|request[_-]?body|response[_-]?(?:body|text)|content)$/i;

function utf8Length(value: string): number {
    return new TextEncoder().encode(value).length;
}

function truncateText(value: string, maxLength = MAX_DIAGNOSTIC_TEXT_LENGTH): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 11))}[TRUNCATED]`;
}

function redactUrls(value: string): string {
    return value.replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (raw) => {
        const queryIndex = raw.search(/[?#]/);
        const authorityAndPath = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
        // URL userinfo can contain a credential even when no query exists.
        const withoutUserInfo = authorityAndPath.replace(
            /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)(?:[^/@\s]+):[^/@\s]+@/i,
            `$1${REDACTED}@`,
        );
        if (queryIndex < 0) return withoutUserInfo;
        return `${withoutUserInfo}?${QUERY_REDACTED}`;
    });
}

function redactAssignments(value: string): string {
    return value.replace(
        /\b(api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|authorization|cookie|credential|private[-_]?key)\b\s*[:=]\s*(?:bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;)}\]]+)/gi,
        (_match, key: string) => `${key}=${REDACTED}`,
    );
}

function redactBearerAndTokenFormats(value: string): string {
    let result = value.replace(/\bBearer\s+[^\s,;)}\]]+/gi, `Bearer ${REDACTED}`);
    // Common provider/token prefixes. This is deliberately conservative so
    // normal IDs such as glm-5 and conversation IDs remain useful.
    result = result.replace(/\b(?:sk|pk|ghp|gho|github_pat|xox[baprs]|AIza)[-_][A-Za-z0-9._-]{12,}\b/gi, REDACTED);
    result = result.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED);
    return result;
}

function redactGenericQuery(value: string): string {
    return value.replace(/\?[^\s"'<>]*=[^\s"'<>]*/g, `?${QUERY_REDACTED}`);
}

/** Redacts secrets, URLs' query strings, and bounds human-readable text. */
export function redactDiagnosticText(value: string, maxLength = MAX_DIAGNOSTIC_TEXT_LENGTH): string {
    let result = String(value);
    result = redactUrls(result);
    result = redactBearerAndTokenFormats(result);
    result = redactAssignments(result);
    result = redactGenericQuery(result);
    return truncateText(result, maxLength);
}

function isBinary(value: unknown): boolean {
    return typeof Buffer !== "undefined" && (
        value instanceof Buffer ||
        (typeof value === "object" && value !== null && (value as { constructor?: { name?: string } }).constructor?.name === "Buffer")
    );
}

function redactValue(value: unknown, limits: RedactionLimits, depth: number, seen: Set<object>): unknown {
    if (depth > limits.maxDepth) return "[MAX_DEPTH]";
    if (value === null || value === undefined) return value;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : "[NON_FINITE_NUMBER]";
    if (typeof value === "bigint") return "[BIGINT]";
    if (typeof value === "string") return redactDiagnosticText(value, limits.maxStringLength);
    if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[INVALID_DATE]" : value.toISOString();
    if (value instanceof Error) {
        const error = value as Error & { code?: unknown; status?: unknown };
        return {
            name: redactDiagnosticText(error.name, 128),
            message: redactDiagnosticText(error.message),
            ...(typeof error.code === "string" ? { code: redactDiagnosticText(error.code, 128) } : {}),
            ...(typeof error.code === "number" && Number.isFinite(error.code) ? { code: error.code } : {}),
            ...(typeof error.status === "number" ? { status: error.status } : {}),
        };
    }
    if (isBinary(value)) return "[BINARY]";
    if (typeof value !== "object") return redactDiagnosticText(String(value));

    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);

    if (Array.isArray(value)) {
        return value.slice(0, limits.maxArrayLength).map((item) => redactValue(item, limits, depth + 1, seen));
    }

    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value).slice(0, limits.maxObjectKeys)) {
        if (SECRET_KEY_PATTERN.test(key)) {
            result[key] = REDACTED;
        } else if (OMIT_KEY_PATTERN.test(key)) {
            result[key] = OMITTED;
        } else {
            result[key] = redactValue(nested, limits, depth + 1, seen);
        }
    }
    if (Object.keys(value).length > limits.maxObjectKeys) result._truncatedKeys = true;
    return result;
}

/** Recursively redacts diagnostic metadata without retaining an in-memory log. */
export function redactDiagnosticPayload(value: unknown, limits: Partial<RedactionLimits> = {}): unknown {
    const merged: RedactionLimits = {
        ...DEFAULT_LIMITS,
        ...limits,
    };
    return redactValue(value, merged, 0, new Set());
}

/** Produces valid bounded JSON even for circular/unserializable input. */
export function serializeDiagnosticMetadata(value: unknown): string {
    const redacted = redactDiagnosticPayload(value);
    try {
        const serialized = JSON.stringify(redacted);
        if (typeof serialized === "string" && utf8Length(serialized) <= MAX_DIAGNOSTIC_METADATA_BYTES) return serialized;
    } catch {
        // Fall through to the minimal safe representation.
    }

    try {
        const compact = JSON.stringify(redactDiagnosticPayload(value, {
            maxStringLength: 256,
            maxArrayLength: 16,
            maxObjectKeys: 16,
            maxDepth: 3,
        }));
        if (utf8Length(compact) <= MAX_DIAGNOSTIC_METADATA_BYTES) return compact;
    } catch {
        // Fall through.
    }
    return JSON.stringify({ omitted: true, reason: "metadata_size_limit" });
}
