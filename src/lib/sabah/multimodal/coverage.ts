export interface CoveragePage { page: number; text: string; blocks: number }
export interface CoverageMetrics { printableCharacters: number; blockCount: number; blankPageRatio: number; confidenceProxy: number; requiresOcrPages: number[] }
export interface CoverageOptions { forceOcrPages?: readonly number[] }
export const COVERAGE_MIN_PRINTABLE_CHARACTERS = 20;

export function measureExtractionCoverage(pages: readonly CoveragePage[], options: CoverageOptions = {}): CoverageMetrics {
  const printableCharacters = pages.reduce((sum, page) => sum + Array.from(page.text).filter((c) => c.trim().length > 0).length, 0);
  const blockCount = pages.reduce((sum, page) => sum + Math.max(0, page.blocks), 0);
  const lowCoveragePages = pages.filter((page) => Array.from(page.text).filter((c) => c.trim().length > 0).length < COVERAGE_MIN_PRINTABLE_CHARACTERS).map((page) => page.page);
  const forced = options.forceOcrPages ?? [];
  const blankPages = pages.filter((page) => page.text.trim().length === 0).map((page) => page.page);
  const requiresOcrPages = Array.from(new Set([...lowCoveragePages, ...forced])).sort((a, b) => a - b);
  const blankPageRatio = pages.length === 0 ? 1 : blankPages.length / pages.length;
  const confidenceProxy = pages.length === 0 ? 0 : Math.max(0, Math.min(1, (1 - blankPageRatio) * 0.7 + Math.min(1, blockCount / pages.length) * 0.3));
  return { printableCharacters, blockCount, blankPageRatio, confidenceProxy, requiresOcrPages };
}
