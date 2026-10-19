import { createHash } from 'node:crypto';
import { normalizeWorkspaceText } from './normalize';

const VOLATILE_FIELDS = new Set([
  'createdat',
  'updatedat',
  'deletedat',
  'indexedat',
  'fetchedat',
  'generatedat',
  'modifiedat',
  'accessedat',
  'timestamp',
  'modelprose',
  'generatedprose',
  'modeloutput',
]);

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(value: unknown, key?: string): JsonValue | undefined {
  if (key && VOLATILE_FIELDS.has(key.toLowerCase())) return undefined;
  if (value == null) return null;
  if (typeof value === 'string') return normalizeWorkspaceText(value) ?? null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item) ?? null);
  }
  if (typeof value === 'object') {
    const result: { [key: string]: JsonValue } = {};
    for (const objectKey of Object.keys(value).sort()) {
      const item = canonicalize((value as Record<string, unknown>)[objectKey], objectKey);
      if (item !== undefined) result[objectKey] = item;
    }
    return result;
  }
  return undefined;
}

/** Create a content fingerprint independent of presentation and volatile metadata. */
export function createEntityFingerprint(input: unknown): string {
  const canonical = canonicalize(input) ?? null;
  const serialized = JSON.stringify(canonical);
  return createHash('sha256').update(serialized).digest('hex');
}
