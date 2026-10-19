export const OCR_THRESHOLDS = {
  printedArabicCer: 0.08,
  exactTableCellAccuracy: 0.9,
  reviewConfidenceFloor: 0.5,
} as const;

type QualityStatus = "pass" | "fail" | "review";
export type OcrQualityAssessment = {
  status: QualityStatus;
  route: "accept" | "review";
  operationalRecordCount: 0;
};

function assertUnitInterval(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a finite number between 0 and 1`);
  }
}

function normalizePresentation(text: string): string {
  if (typeof text !== "string" || text.length === 0) {
    throw new TypeError("text inputs must be non-empty strings");
  }
  const normalized = text
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[\u0640]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length === 0) throw new TypeError("text inputs must contain non-whitespace content");
  return normalized;
}

function levenshtein(left: readonly string[], right: readonly string[]): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = left[row - 1] === right[column - 1]
        ? diagonal
        : 1 + Math.min(previous[column], previous[column - 1], diagonal);
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function presentationNormalizedCer(reference: string, hypothesis: string): number {
  const expected = Array.from(normalizePresentation(reference));
  const actual = Array.from(normalizePresentation(hypothesis));
  return Math.min(1, levenshtein(expected, actual) / expected.length);
}

export function exactTableCellAccuracy(reference: readonly string[], hypothesis: readonly string[]): number {
  if (!Array.isArray(reference) || !Array.isArray(hypothesis) || reference.some((cell) => typeof cell !== "string") || hypothesis.some((cell) => typeof cell !== "string")) {
    throw new TypeError("cell inputs must be arrays of strings");
  }
  if (reference.length !== hypothesis.length) throw new RangeError("cell inputs must have the same length");
  if (reference.length === 0) return 1;
  return reference.reduce((matches, cell, index) => matches + (cell === hypothesis[index] ? 1 : 0), 0) / reference.length;
}

export function assessOcrQuality(input: {
  cer: number;
  tableCellAccuracy: number;
  confidence: number;
}): OcrQualityAssessment {
  assertUnitInterval(input.cer, "cer");
  assertUnitInterval(input.tableCellAccuracy, "tableCellAccuracy");
  assertUnitInterval(input.confidence, "confidence");
  if (input.confidence < OCR_THRESHOLDS.reviewConfidenceFloor) return { status: "review", route: "review", operationalRecordCount: 0 };
  const pass = input.cer <= OCR_THRESHOLDS.printedArabicCer && input.tableCellAccuracy >= OCR_THRESHOLDS.exactTableCellAccuracy;
  return { status: pass ? "pass" : "fail", route: pass ? "accept" : "review", operationalRecordCount: 0 };
}
