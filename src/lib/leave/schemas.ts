import { z } from "zod";

const date = z.string().datetime({ offset: true });
export const leaveIdSchema = z.object({ id: z.string().min(1) });
export const leavePayloadSchema = z.object({
  startAt: date,
  endAt: date,
  delegateId: z.string().min(1),
  reason: z.string().trim().max(4000).optional(),
  handoverNote: z.string().trim().max(4000).optional(),
  handoverTaskIds: z.array(z.string().min(1)).max(100).optional(),
}).superRefine((v, ctx) => {
  if (new Date(v.startAt) >= new Date(v.endAt)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endAt"], message: "Start date must be before end date" });
  if (v.handoverTaskIds && new Set(v.handoverTaskIds).size !== v.handoverTaskIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["handoverTaskIds"], message: "Duplicate task IDs are not allowed" });
});
export const updateLeaveSchema = z.object({ startAt: date.optional(), endAt: date.optional(), delegateId: z.string().min(1).optional(), reason: z.string().trim().max(4000).optional(), id: z.string().min(1), expectedFingerprint: z.string().min(1).optional() }).superRefine((v, ctx) => { if (v.startAt && v.endAt && new Date(v.startAt) >= new Date(v.endAt)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endAt"], message: "Start date must be before end date" }); });
export const handoverPayloadSchema = z.object({ id: z.string().min(1), handoverNote: z.string().trim().max(4000).optional(), handoverTaskIds: z.array(z.string().min(1)).min(1).max(100), expectedFingerprint: z.string().min(1).optional() }).superRefine((v, ctx) => { if (new Set(v.handoverTaskIds).size !== v.handoverTaskIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["handoverTaskIds"], message: "Duplicate task IDs are not allowed" }); });
export const leaveSearchSchema = z.object({ query: z.string().trim().max(200).optional(), status: z.string().optional(), limit: z.number().int().min(1).max(100).default(50) });
export const returnReportSchema = leaveIdSchema;
export type LeavePayload = z.infer<typeof leavePayloadSchema>;
export type UpdateLeaveInput = z.infer<typeof updateLeaveSchema>;
export type HandoverInput = z.infer<typeof handoverPayloadSchema>;
export const leaveFingerprint = (leave: { id: string; userId: string; delegateId: string; startAt: Date | string; endAt: Date | string; reason?: string | null; status?: string }) => [leave.id, leave.userId, leave.delegateId, new Date(leave.startAt).toISOString(), new Date(leave.endAt).toISOString(), leave.reason ?? "", leave.status ?? ""].join("|");
