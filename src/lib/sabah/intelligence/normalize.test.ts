import { describe, expect, it } from 'vitest';
import { normalizeWorkspaceText } from './normalize';

describe('normalizeWorkspaceText', () => {
  it('normalizes Arabic orthography, digits, punctuation, whitespace, and case', () => {
    expect(normalizeWorkspaceText('  إِدارةُـــ ١٢٣،  Foo!  ')).toBe('ادارة 123, foo!');
    expect(normalizeWorkspaceText('أ إ آ ٱ')).toBe('ا ا ا ا');
    expect(normalizeWorkspaceText('۱۲۳ ١٢٣ 123')).toBe('123 123 123');
  });

  it('normalizes the exact Plan 5 Arabic example', () => {
    expect(normalizeWorkspaceText('قِياسـ وتعزيز الصُّورة  الذهنية')).toBe('قياس وتعزيز الصورة الذهنية');
  });

  it('applies Unicode normalization and removes Arabic marks', () => {
    expect(normalizeWorkspaceText('Cafe\u0301 مُدِير')).toBe('café مدير');
  });

  it('is null-safe', () => {
    expect(normalizeWorkspaceText(null)).toBeNull();
    expect(normalizeWorkspaceText(undefined)).toBeUndefined();
    expect(normalizeWorkspaceText('')).toBe('');
  });
});
