import { z } from "zod";
import { kpiPeriodSchema } from "@/lib/kpis/schemas";

/**
 * Canonical capability input for kpis.logUpdate. Proposal and direct-chat
 * adapters must use this shape so approval compares the same material input.
 * expectedUpdatedAt is optional only while resolving a direct request; a
 * persisted proposal must supply the captured concurrency version.
 */
export const canonicalKpiLogUpdateSchema = z.object({
  id: z.string().min(1),
  value: z.number().finite(),
  note: z.string().nullable().optional(),
  period: kpiPeriodSchema,
  score: z.number().finite().min(0).max(5).optional(),
  expectedUpdatedAt: z.string().datetime(),
}).strict();

const unboundKpiLogUpdateSchema = canonicalKpiLogUpdateSchema.omit({ expectedUpdatedAt: true });

const INPUT_KEYS = new Set(["id", "kpiId", "value", "note", "period", "quarter", "score", "expectedUpdatedAt"]);

type UnknownRecord = Record<string, unknown>;

/** Normalize the legacy kpiId/quarter shape without adding a live DB value. */
export function canonicalizeKpiLogUpdate(raw: unknown, capturedExpectedUpdatedAt?: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid KPI log-update input");
  const source = raw as UnknownRecord;
  for (const key of Object.keys(source)) if (!INPUT_KEYS.has(key)) throw new Error(`Unsupported KPI log-update field: ${key}`);

  if (source.id !== undefined && source.kpiId !== undefined && source.id !== source.kpiId) throw new Error("KPI id fields do not match");
  if (source.period !== undefined && source.quarter !== undefined && source.period !== source.quarter) throw new Error("KPI period fields do not match");
  if (source.expectedUpdatedAt !== undefined && typeof source.expectedUpdatedAt !== "string") throw new Error("Invalid KPI concurrency version");

  const expectedUpdatedAt = capturedExpectedUpdatedAt ?? source.expectedUpdatedAt;
  const candidate: UnknownRecord = {
    id: source.id ?? source.kpiId,
    value: source.value,
    note: source.note ?? null,
    period: source.period ?? source.quarter,
    ...(source.score === undefined ? {} : { score: source.score }),
    ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
  };
  return (expectedUpdatedAt === undefined ? unboundKpiLogUpdateSchema : canonicalKpiLogUpdateSchema).parse(candidate);
}
