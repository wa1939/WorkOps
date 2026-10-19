export type SyntheticCorpusFixture = {
  fixtureId: `synthetic-${string}`;
  creationMethod: "hand-authored synthetic fixture";
  license: "CC0-1.0";
  source: "Plan 7 Task 10 synthetic corpus";
  checksum: `not-recorded:${string}`;
};

/** Metadata-only fixtures: binary assets are intentionally not checked in. */
export const SYNTHETIC_MULTIMODAL_CORPUS: readonly SyntheticCorpusFixture[] = [
  {
    fixtureId: "synthetic-arabic-printed-form-01",
    creationMethod: "hand-authored synthetic fixture",
    license: "CC0-1.0",
    source: "Plan 7 Task 10 synthetic corpus",
    checksum: "not-recorded:no-binary-fixture",
  },
  {
    fixtureId: "synthetic-table-cells-01",
    creationMethod: "hand-authored synthetic fixture",
    license: "CC0-1.0",
    source: "Plan 7 Task 10 synthetic corpus",
    checksum: "not-recorded:no-binary-fixture",
  },
  {
    fixtureId: "synthetic-arabic-speech-quiet-01",
    creationMethod: "hand-authored synthetic fixture",
    license: "CC0-1.0",
    source: "Plan 7 Task 10 synthetic corpus",
    checksum: "not-recorded:no-binary-fixture",
  },
] as const;
