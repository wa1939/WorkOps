import { z } from "zod";

export const savedViewScopeSchema = z.enum(["PERSONAL", "TEAM"]);
const blockTypeSchema = z.enum(["text", "header", "image", "embed", "taskView", "progress", "divider", "callout", "quote", "todo", "code", "statTile", "chart", "toggle", "gallery", "kpiSnapshot", "projectSnapshot", "assistantWorkspace"]);
const blockSchema = z.object({
  id: z.string().min(1), type: blockTypeSchema, content: z.string().optional(), size: z.enum(["h1", "h2", "h3"]).optional(), url: z.string().optional(),
  viewType: z.enum(["board", "table", "calendar", "gallery", "timeline"]).optional(), filters: z.record(z.string()).optional(), formula: z.string().optional(), width: z.enum(["full", "half", "third"]).optional(),
  variant: z.string().optional(), attribution: z.string().optional(), items: z.unknown().optional(), language: z.string().optional(), metric: z.string().optional(), label: z.string().optional(), tone: z.string().optional(), chartKind: z.string().optional(), title: z.string().optional(), urls: z.array(z.string()).optional(), cols: z.number().int().optional(), kpiId: z.string().optional(), projectId: z.string().optional(), projectSelectionRequired: z.boolean().optional(), assistantLayout: z.enum(["context", "focused"]).optional(), assistantAccent: z.enum(["sky", "plum", "ember", "sage"]).optional(), projectIds: z.array(z.string()).optional(), assigneeIds: z.array(z.string()).optional(), tagIds: z.array(z.string()).optional(), dueRange: z.string().optional(), sortBy: z.string().optional(), sortDir: z.enum(["asc", "desc"]).optional(), groupBy: z.string().optional(), columns: z.array(z.string()).optional(),
}).strict();
export const blocksJsonValueSchema = z.union([
  z.array(blockSchema).max(100),
  z.object({ __meta: z.object({ cover: z.string().nullable().optional() }).strict().optional(), blocks: z.array(blockSchema).max(100) }).strict(),
]);
export const blocksJsonSchema = z.string().superRefine((raw, ctx) => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "blocksJson must be valid JSON" }); return; }
  const result = blocksJsonValueSchema.safeParse(parsed);
  if (!result.success) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "blocksJson contains an unsupported block" });
});
export const savedViewIdSchema = z.string().min(1);
export const savedViewSearchSchema = z.object({ query: z.string().trim().max(200).default(""), limit: z.number().int().min(1).max(100).default(50) }).strict();
export const createSavedViewSchema = z.object({ name: z.string().trim().min(1).max(200), description: z.string().nullable().optional(), icon: z.string().nullable().optional(), color: z.string().trim().min(1).max(40).default("blue"), blocksJson: blocksJsonSchema.default("[]"), scope: savedViewScopeSchema }).strict();
export const updateSavedViewSchema = z.object({ name: z.string().trim().min(1).max(200).optional(), description: z.string().nullable().optional(), icon: z.string().nullable().optional(), color: z.string().trim().min(1).max(40).optional(), blocksJson: blocksJsonSchema.optional(), scope: savedViewScopeSchema.optional(), expectedUpdatedAt: z.string().datetime() }).strict();
export type SavedViewActorInput = z.infer<typeof createSavedViewSchema>;
export type SavedViewUpdateInput = z.infer<typeof updateSavedViewSchema>;
export type SavedViewSearchInput = z.infer<typeof savedViewSearchSchema>;
