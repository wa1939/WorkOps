import { z } from "zod";

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function isRealCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidClockTime(value: string): boolean {
  const match = CLOCK_TIME_PATTERN.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/** Raw HTML control schemas used before constructing a task dueAt Date. */
export const taskDueDateInputSchema = z.string().refine((value) => value === "" || isRealCalendarDate(value));
export const taskDueTimeInputSchema = z.string().refine(isValidClockTime);

export const taskStatusSchema = z.enum(["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"]);
export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const taskReferenceIdSchema = z.string().trim().min(1);
export const taskIdListSchema = z.array(taskReferenceIdSchema);
const isoDateTimeSchema = z.string().datetime({ offset: true });
export const createTaskSchema = z.object({
  title: z.string().trim().min(1), description: z.string().optional().nullable(),
  status: taskStatusSchema.optional(), priority: taskPrioritySchema.optional(),
  startAt: isoDateTimeSchema.optional().nullable(), dueAt: isoDateTimeSchema.optional().nullable(), dueAtEnd: isoDateTimeSchema.optional().nullable(),
  effortHours: z.number().nonnegative().optional().nullable(), isPrivate: z.boolean().optional(), projectId: taskReferenceIdSchema.optional().nullable(), caseStudyId: taskReferenceIdSchema.optional().nullable(), kpiId: taskReferenceIdSchema.optional().nullable(), stageId: taskReferenceIdSchema.optional().nullable(), parentTaskId: taskReferenceIdSchema.optional().nullable(),
  assigneeIds: taskIdListSchema.optional(), tagIds: taskIdListSchema.optional(), dependencyIds: taskIdListSchema.optional(), reminders: z.array(z.number().int().positive()).optional(),
  idempotencyKey: taskReferenceIdSchema.optional(), recurrenceKey: taskReferenceIdSchema.optional(),
});
export const updateTaskSchema = createTaskSchema.partial().extend({
  progressMode: z.enum(["manual", "subtasks"]).optional(),
  estimateMinutes: z.number().int().nonnegative().optional().nullable(),
  manualProgress: z.number().int().min(0).max(100).optional().nullable(),
  actualHours: z.number().optional().nullable(),
  plannedStartAt: isoDateTimeSchema.optional().nullable(),
  plannedEndAt: isoDateTimeSchema.optional().nullable(),
  isStarred: z.boolean().optional(),
  expectedUpdatedAt: z.union([isoDateTimeSchema, z.date()]).optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type CreateTaskFieldKey = keyof CreateTaskInput;
export const CREATE_TASK_FIELD_KEYS: readonly CreateTaskFieldKey[] = Object.freeze(
  Object.keys(createTaskSchema.shape) as CreateTaskFieldKey[],
);
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
