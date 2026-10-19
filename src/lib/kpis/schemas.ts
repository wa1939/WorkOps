import { z } from "zod";

export const kpiStatusSchema = z.enum(["ON_TRACK", "AT_RISK", "OFF_TRACK"]);
export const kpiPeriodSchema = z.enum(["Q1", "Q2", "Q3", "Q4", "ANNUAL"]);

const nullableNumber = z.number().finite().nullable().optional();
export const kpiFieldsSchema = z.object({
  perspective: z.string().trim().min(1), objective: z.string().trim().min(1), name: z.string().trim().min(1),
  definition: z.string().optional().nullable(), formula: z.string().optional().nullable(), dataSource: z.string().optional().nullable(), metric: z.string().optional().nullable(), unit: z.string().optional().nullable(), weight: nullableNumber,
  annualTarget: nullableNumber, calculationType: z.string().optional().nullable(), level1: nullableNumber, level2: nullableNumber, level3: nullableNumber, level4: nullableNumber, level5: nullableNumber,
  q1Target: nullableNumber, q2Target: nullableNumber, q3Target: nullableNumber, q4Target: nullableNumber,
  trackingPeriod: kpiPeriodSchema.optional(), status: kpiStatusSchema.optional(),
  ownerId: z.null().optional(),
});
export const createKpiSchema = kpiFieldsSchema;
export const updateKpiSchema = kpiFieldsSchema.partial().extend({ id: z.string().min(1), expectedUpdatedAt: z.string().datetime() });
export const logKpiUpdateSchema = z.object({ id: z.string().min(1), value: z.number().finite(), note: z.string().optional().nullable(), period: kpiPeriodSchema, quarter: kpiPeriodSchema.optional(), score: z.number().finite().min(0).max(5).optional(), expectedUpdatedAt: z.string().datetime() });
export const linkProjectObjectiveSchema = z.object({ kpiId: z.string().min(1), projectObjectiveId: z.string().min(1), expectedUpdatedAt: z.string().datetime() });
export type CreateKpiInput = z.infer<typeof createKpiSchema>;
export type UpdateKpiInput = z.infer<typeof updateKpiSchema>;
export type LogKpiUpdateInput = z.infer<typeof logKpiUpdateSchema>;
