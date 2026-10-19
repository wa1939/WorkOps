import { z } from "zod";

export function normalizeContactEmail(email: string): string {
    return email.trim().toLocaleLowerCase("en-US");
}

export const externalContactInputSchema = z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
    department: z.string().trim().max(120).nullable().default(null),
    organization: z.string().trim().max(120).nullable().default(null),
}).strict();

export const externalContactPatchSchema = externalContactInputSchema.partial().extend({ isArchived: z.boolean().optional() }).strict();
