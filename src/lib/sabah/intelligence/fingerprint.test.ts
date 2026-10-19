import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DuplicateCandidate, SourceRef, WorkspaceEntityType } from './contracts';
import { createEntityFingerprint } from './fingerprint';

describe('createEntityFingerprint', () => {
  it('accepts the complete Plan 5 provenance and duplicate contract shape', () => {
    const source: SourceRef = {
      entityType: 'TASK' satisfies WorkspaceEntityType,
      entityId: 'TASK-12',
      label: 'Plan',
      href: '/tasks/TASK-12',
      sourceUpdatedAt: '2026-08-26T10:00:00Z',
      checksum: 'abc123',
    };
    const duplicate: DuplicateCandidate = {
      source,
      duplicateOf: source,
      score: 0.95,
      overlap: 'LIKELY_DUPLICATE',
      reasons: ['same normalized title'],
    };
    expect(duplicate.overlap).toBe('LIKELY_DUPLICATE');
    expect(duplicate.reasons).toEqual(['same normalized title']);
    expect(source.href).toBe('/tasks/TASK-12');
    expect(source.sourceUpdatedAt).toBe('2026-08-26T10:00:00Z');
    expect(source.checksum).toBe('abc123');
  });

  it('is stable across object key ordering, whitespace, and Arabic digit variants', () => {
    const left = { title: '  Foo  ', id: 'TASK-١٢', dueDate: '2026-08-01', tags: ['A', ' B'] };
    const right = { tags: ['a', 'b'], dueDate: '2026-08-01', id: 'TASK-12', title: 'foo' };
    expect(createEntityFingerprint(left)).toBe(createEntityFingerprint(right));
  });

  it('matches the exact Plan 5 Arabic and Western digit example', () => {
    const arabicDigits = { projectId: 'PRJ-٢٠٢٦', title: 'قياس ٢٠٢٦', dueDate: '٢٠٢٦-٠٨-٠١' };
    const westernDigits = { projectId: 'PRJ-2026', title: 'قياس 2026', dueDate: '2026-08-01' };
    expect(createEntityFingerprint(arabicDigits)).toBe(createEntityFingerprint(westernDigits));
  });

  it('preserves meaningful identifiers and dates', () => {
    expect(createEntityFingerprint({ id: 'Case-١٢', sourceUpdatedAt: '2026-08-26T10:00:00Z' }))
      .not.toBe(createEntityFingerprint({ id: 'Case-13', sourceUpdatedAt: '2026-08-26T10:00:00Z' }));
    expect(createEntityFingerprint({ dueDate: '2026-٠٨-٠١' })).toBe(
      createEntityFingerprint({ dueDate: '2026-08-01' }),
    );
    expect(createEntityFingerprint({ sourceUpdatedAt: '2026-08-26T10:00:00Z' })).not.toBe(
      createEntityFingerprint({ sourceUpdatedAt: '2026-08-27T10:00:00Z' }),
    );
    expect(createEntityFingerprint({ dueDate: '2026-08-01' })).not.toBe(
      createEntityFingerprint({ dueDate: '2026-08-02' }),
    );
  });

  it('excludes only exact volatile metadata and model-output keys', () => {
    const base = {
      id: 'TASK-12',
      title: 'Plan',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      deletedAt: '2026-01-01T00:00:00Z',
      indexedAt: '2026-01-01T00:00:00Z',
      fetchedAt: '2026-01-01T00:00:00Z',
      generatedAt: '2026-01-01T00:00:00Z',
      modifiedAt: '2026-01-01T00:00:00Z',
      accessedAt: '2026-01-01T00:00:00Z',
      timestamp: '2026-01-01T00:00:00Z',
      modelProse: 'first',
      generatedProse: 'first',
      modelOutput: 'first',
    };
    const changed = {
      ...base,
      CREATEDAT: '2027-01-01T00:00:00Z',
      UPDATEDAT: '2027-01-01T00:00:00Z',
      MODELOUTPUT: 'second',
      modelProse: 'second',
      generatedProse: 'second',
    };
    expect(createEntityFingerprint(base)).toBe(createEntityFingerprint(changed));
  });

  it('preserves timestamp-like business fields', () => {
    expect(createEntityFingerprint({ eventTimestamp: '2026-01-01T00:00:00Z' })).not.toBe(
      createEntityFingerprint({ eventTimestamp: '2027-01-01T00:00:00Z' }),
    );
  });

  it('canonicalizes nested keys and arrays deterministically', () => {
    expect(createEntityFingerprint({ z: [{ b: 2, a: 1 }], a: null })).toBe(
      createEntityFingerprint({ a: null, z: [{ a: 1, b: 2 }] }),
    );
  });

  it('returns the SHA-256 digest of canonical JSON', () => {
    const canonical = JSON.stringify({ id: 'x', title: 'hello' });
    const expected = createHash('sha256').update(canonical).digest('hex');
    expect(createEntityFingerprint({ title: 'hello', id: 'x' })).toBe(expected);
  });
});
