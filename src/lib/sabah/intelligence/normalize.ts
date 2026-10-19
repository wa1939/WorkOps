const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const ARABIC_DIGITS = /[\u0660-\u0669]/g;
const PERSIAN_DIGITS = /[\u06F0-\u06F9]/g;

const ALEF_VARIANTS = /[أإآٱ]/g;
const ARABIC_PUNCTUATION: Record<string, string> = {
  '،': ',',
  '؛': ';',
  '؟': '?',
  '٪': '%',
  '٫': '.',
  '٬': ',',
};

/** Normalize user-visible Arabic/English text without translating its meaning. */
export function normalizeWorkspaceText(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;

  return value
    .normalize('NFKC')
    .replace(/ـ/g, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(ALEF_VARIANTS, 'ا')
    .replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[،؛؟٪٫٬]/g, (punctuation) => ARABIC_PUNCTUATION[punctuation])
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim();
}
