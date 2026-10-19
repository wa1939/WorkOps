export const ASR_THRESHOLDS = {
  quietWer: 0.15,
  noisyWer: 0.25,
  terminologyAccuracy: 0.9,
  reviewConfidenceFloor: 0.5,
} as const;

type QualityStatus = "pass" | "fail" | "review";
export type AsrQualityAssessment = {
  status: QualityStatus;
  route: "accept" | "review";
  operationalRecordCount: 0;
};

function tokenize(text: string, name: string): string[] {
  if (typeof text !== "string") throw new TypeError(`${name} must be a string`);
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new TypeError(`${name} must be non-empty`);
  return tokens;
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

/** Reference first; punctuation is retained because this is a presentation-agnostic metric. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  if (typeof reference !== "string" || typeof hypothesis !== "string") {
    throw new TypeError("reference and hypothesis must be strings");
  }
  if (reference.trim() === "" && hypothesis.trim() === "") return 0;
  const expected = tokenize(reference, "reference");
  const actual = tokenize(hypothesis, "hypothesis");
  return levenshtein(expected, actual) / expected.length;
}

export function terminologyAccuracy(referenceTerms: readonly string[], hypothesisTerms: readonly string[]): number {
  if (!Array.isArray(referenceTerms) || !Array.isArray(hypothesisTerms)) throw new TypeError("term inputs must be arrays");
  if (referenceTerms.length !== hypothesisTerms.length) throw new RangeError("term inputs must have the same length");
  if (referenceTerms.length === 0) return 1;
  return referenceTerms.reduce((matches, term, index) => {
    if (typeof term !== "string" || typeof hypothesisTerms[index] !== "string") throw new TypeError("terms must be strings");
    return matches + (term.trim().toLocaleLowerCase() === hypothesisTerms[index].trim().toLocaleLowerCase() ? 1 : 0);
  }, 0) / referenceTerms.length;
}

function assertUnitInterval(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a finite number between 0 and 1`);
  }
}

export function assessAsrQuality(input: {
  quietWer: number;
  noisyWer: number;
  terminology: number;
  confidence: number;
}): AsrQualityAssessment {
  assertUnitInterval(input.quietWer, "quietWer");
  assertUnitInterval(input.noisyWer, "noisyWer");
  assertUnitInterval(input.terminology, "terminology");
  assertUnitInterval(input.confidence, "confidence");
  if (input.confidence < ASR_THRESHOLDS.reviewConfidenceFloor) return { status: "review", route: "review", operationalRecordCount: 0 };
  const pass = input.quietWer <= ASR_THRESHOLDS.quietWer
    && input.noisyWer <= ASR_THRESHOLDS.noisyWer
    && input.terminology >= ASR_THRESHOLDS.terminologyAccuracy;
  return { status: pass ? "pass" : "fail", route: pass ? "accept" : "review", operationalRecordCount: 0 };
}
