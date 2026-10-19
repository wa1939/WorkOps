export type SecretScanResult<T> = { value: T; redacted: boolean };

const SECRET_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\bBasic\s+[A-Za-z0-9+/=]+/gi,
  /\b(?:api[_-]?key|apikey|x-api-key)\s*[:=]\s*['"]?[^\s,'";]+/gi,
  /\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|token|secret)\s*[:=]\s*['"]?[^\s,'";]+/gi,
  /\b(?:cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi,
  /\bsk_(?:live|test)_[A-Za-z0-9]+/g,
  /\bgh[pousr]_[A-Za-z0-9_]+/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
]);

function redactString(value: string, configuredHashes: readonly string[]): SecretScanResult<string> {
  let result = value;
  let redacted = false;
  for (const hash of configuredHashes) {
    if (hash.length > 0 && result.includes(hash)) {
      result = result.split(hash).join("[REDACTED]");
      redacted = true;
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    const next = result.replace(pattern, "[REDACTED]");
    redacted ||= next !== result;
    result = next;
  }
  return { value: result, redacted };
}

function scan<T>(value: T, hashes: readonly string[], seen: Set<object>): SecretScanResult<T> {
  if (typeof value === "string") return redactString(value, hashes) as SecretScanResult<T>;
  if (value === null || typeof value !== "object") return { value, redacted: false };
  if (seen.has(value)) return { value: "[CIRCULAR]" as T, redacted: true };
  seen.add(value);
  if (Array.isArray(value)) {
    let redacted = false;
    const next = value.map((item) => { const result = scan(item, hashes, new Set(seen)); redacted ||= result.redacted; return result.value; });
    return { value: next as T, redacted };
  }
  let redacted = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|token|secret|api[-_]?key|authorization|cookie|credential/i.test(key)) {
      next[key] = "[REDACTED]";
      redacted = true;
    } else {
      const result = scan(item, hashes, new Set(seen));
      next[key] = result.value;
      redacted ||= result.redacted;
    }
  }
  return { value: next as T, redacted };
}

/** Redacts secrets without returning or logging the matched values. */
export function scanAndRedactSecrets<T>(value: T, configuredCredentialHashes: readonly string[] = []): SecretScanResult<T> {
  return scan(value, configuredCredentialHashes, new Set<object>());
}
