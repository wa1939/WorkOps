import { z } from "zod";

const id = z.string().trim().min(1);
const date = z.string().datetime().nullable().optional();

export const createCaseStudySchema = z.object({
  name: z.string().trim().min(1).max(300),
  brief: z.string().max(20000).nullable().optional(),
  status: z.string().trim().min(1).max(100).optional(),
  dueAt: date,
  dueAtEnd: date,
  ownerId: id.nullable().optional(),
  workAreaId: id.nullable().optional(),
  departmentIds: z.array(id).max(100).optional(),
  memberIds: z.array(id).max(100).optional(),
});

export const updateCaseStudySchema = createCaseStudySchema.partial();
export const caseStudyIdSchema = z.object({ id });
export const caseStudySearchSchema = z.object({
  query: z.string().trim().max(200).default(""),
  status: z.string().optional(), workAreaId: id.nullable().optional(),
  requestingDepartmentId: id.optional(), floating: z.boolean().optional(),
});
export const planCaseStudyTasksSchema = z.object({
  caseStudyId: id,
  tasks: z.array(z.record(z.unknown())).min(1).max(100),
  allowPartial: z.boolean().default(false),
});
export type CreateCaseStudyInput = z.infer<typeof createCaseStudySchema>;
export type UpdateCaseStudyInput = z.infer<typeof updateCaseStudySchema>;
export type CaseStudySearchInput = z.infer<typeof caseStudySearchSchema>;
export type PlanCaseStudyTasksInput = z.infer<typeof planCaseStudyTasksSchema>;
