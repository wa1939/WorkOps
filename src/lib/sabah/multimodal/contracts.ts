import { z } from "zod";

export const PROCESSING_MODES = ["LOCAL_ONLY", "LOCAL_PREFERRED", "CLOUD_QUALITY"] as const;
export type ProcessingMode = (typeof PROCESSING_MODES)[number];

const boundedId = z.string().trim().min(1).max(200);
const boundedText = z.string().max(20_000);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "must be a SHA-256 checksum");
const nonNegativeInt = z.number().int().min(0);

export const assetDescriptorSchema = z.object({
  id: boundedId,
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
  byteCount: z.number().int().positive().max(5_000_000_000),
  checksum: sha256,
  storageKey: z.string().trim().min(1).max(500).nullable().optional(),
}).strict();
export type AssetDescriptor = z.infer<typeof assetDescriptorSchema>;

const boundingBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
}).strict().superRefine((box, ctx) => {
  if (box.x + box.width > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bounding box exceeds horizontal bounds" });
  if (box.y + box.height > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bounding box exceeds vertical bounds" });
});

export const sourceBlockSchema = z.object({
  id: boundedId,
  assetId: boundedId,
  kind: z.enum(["TEXT", "TABLE", "FORMULA", "IMAGE_CAPTION", "TRANSCRIPT"]),
  text: boundedText,
  page: z.number().int().min(1).max(100_000).optional(),
  timeStartMs: nonNegativeInt.max(86_400_000).optional(),
  timeEndMs: nonNegativeInt.max(86_400_000).optional(),
  boundingBox: boundingBoxSchema.optional(),
  confidence: z.number().min(0).max(1),
  engine: z.string().trim().min(1).max(200),
  engineVersion: z.string().trim().min(1).max(100),
  checksum: sha256,
  reviewed: z.boolean(),
}).strict().superRefine((block, ctx) => {
  const hasPage = block.page !== undefined;
  const hasStart = block.timeStartMs !== undefined;
  const hasEnd = block.timeEndMs !== undefined;
  if (!hasPage && !(hasStart && hasEnd)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "source block requires page or time provenance" });
  }
  if (hasStart !== hasEnd) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "time provenance requires both start and end" });
  }
  if (hasStart && hasEnd && block.timeEndMs! < block.timeStartMs!) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "time end must not precede time start" });
  }
});
export type SourceBlock = z.infer<typeof sourceBlockSchema>;

export const intakeRequestSchema = z.object({
  assets: z.array(assetDescriptorSchema).max(100),
  mode: z.enum(PROCESSING_MODES).default("LOCAL_PREFERRED"),
}).strict();
export type IntakeRequest = z.infer<typeof intakeRequestSchema>;

export const extractionMetricsSchema = z.object({
  pageCount: nonNegativeInt.max(100_000),
  blockCount: nonNegativeInt.max(1_000_000),
  extractedChars: nonNegativeInt.max(20_000_000),
  durationMs: nonNegativeInt.max(86_400_000),
  truncated: z.boolean(),
}).strict();
export type ExtractionMetrics = z.infer<typeof extractionMetricsSchema>;

export const extractionRunResultSchema = z.object({
  status: z.enum(["SUCCEEDED", "PARTIAL", "FAILED"]),
  requestedMode: z.enum(PROCESSING_MODES),
  effectiveMode: z.enum(PROCESSING_MODES),
  metrics: extractionMetricsSchema,
  errorCode: z.string().trim().min(1).max(100).optional(),
}).strict().superRefine((result, ctx) => {
  if (result.status === "SUCCEEDED" && result.errorCode !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: "succeeded extraction cannot include an error code" });
  }
  if (result.status === "FAILED" && result.errorCode === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: "failed extraction requires an error code" });
  }
  const modeCoherent = result.requestedMode === "LOCAL_ONLY"
    ? result.effectiveMode === "LOCAL_ONLY"
    : result.requestedMode === "LOCAL_PREFERRED"
      ? result.effectiveMode !== "LOCAL_PREFERRED"
      : result.effectiveMode === "CLOUD_QUALITY";
  if (!modeCoherent) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveMode"], message: "effective processing mode is incompatible with requested mode" });
  }
});
export type ExtractionRunResult = z.infer<typeof extractionRunResultSchema>;

export const processingConsentSchema = z.object({
  actorId: boundedId,
  assetChecksum: sha256,
  provider: z.string().trim().min(1).max(100),
  purpose: z.string().trim().min(1).max(500),
  expiresAt: z.coerce.date(),
  decision: z.enum(["APPROVED", "DENIED"]),
}).strict();
export type ProcessingConsent = z.infer<typeof processingConsentSchema>;
