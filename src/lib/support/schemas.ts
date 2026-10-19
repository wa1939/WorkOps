import { z } from "zod";

export const supportRequestIdSchema = z.string().trim().min(1);
export const supportRequestQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  projectId: supportRequestIdSchema.optional(),
  taskId: supportRequestIdSchema.optional(),
  status: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export const createSupportRequestSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10000).optional().nullable(),
  projectId: supportRequestIdSchema.optional().nullable(),
  taskId: supportRequestIdSchema.optional().nullable(),
}).refine((value) => Boolean(value.projectId || value.taskId), {
  message: "A support request must be linked to a project or task",
  path: ["projectId"],
});

export type SupportRequestQuery = z.infer<typeof supportRequestQuerySchema>;
export type CreateSupportRequestInput = z.infer<typeof createSupportRequestSchema>;
