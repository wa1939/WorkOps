import { z } from "zod";

const calendarDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const uniqueIds = z
    .array(z.string().min(1))
    .refine(
        (values) => new Set(values).size === values.length,
        "IDs must be unique",
    );
const reminderOffsets = z
    .array(z.number().int().min(0).max(365))
    .refine(
        (values) => new Set(values).size === values.length,
        "Reminder offsets must be unique",
    );

export const externalActionCreateSchema = z
    .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
        ownerId: z.string().min(1),
        externalContactId: z.string().min(1),
        dueDate: calendarDate,
        projectId: z.string().min(1).nullable().optional(),
        caseStudyId: z.string().min(1).nullable().optional(),
        collaboratorIds: uniqueIds.default([]),
        tagIds: uniqueIds.default([]),
        dependencyIds: uniqueIds.default([]),
        reminderOffsets: reminderOffsets.default([30, 7, 0]),
        overdueIntervalDays: z
            .number()
            .int()
            .min(1)
            .max(90)
            .nullable()
            .default(7),
        // Optional: classify an unclassified parent atomically as part of create.
        classifyParentWorkAreaId: z.string().min(1).nullable().optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (Boolean(value.projectId) === Boolean(value.caseStudyId)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["projectId"],
                message: "Select exactly one project or case study",
            });
        }
    });

export const externalActionUpdateSchema = z
    .object({
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().min(1).optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
        status: z.enum(["TODO", "DOING", "BLOCKED", "WAITING"]).optional(),
        ownerId: z.string().min(1).optional(),
        externalContactId: z.string().min(1).optional(),
        dueDate: calendarDate.optional(),
        projectId: z.string().min(1).nullable().optional(),
        caseStudyId: z.string().min(1).nullable().optional(),
        collaboratorIds: uniqueIds.optional(),
        tagIds: uniqueIds.optional(),
        dependencyIds: uniqueIds.optional(),
        reminderOffsets: reminderOffsets.optional(),
        overdueIntervalDays: z
            .number()
            .int()
            .min(1)
            .max(90)
            .nullable()
            .optional(),
    })
    .strict();

export const evidenceSchema = z.object({
    label: z.string().trim().min(1).max(120),
    url: z
        .string()
        .url()
        .regex(/^https:\/\//i, "Evidence URL must use HTTPS"),
});

export const responseSchema = z.object({
    comment: z.string().trim().min(1),
    evidence: evidenceSchema.optional(),
});

export const lifecycleSchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("close"),
        closureNote: z.string().trim().optional(),
    }),
    z.object({ action: z.literal("cancel"), reason: z.string().trim().min(1) }),
    z.object({ action: z.literal("reopen") }),
]);

export const markFollowUpSentSchema = z.object({
    eventId: z.string().min(1).optional(),
    confirmedSent: z.literal(true),
    recipient: z.string().email(),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1),
});
