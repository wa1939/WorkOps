import { z } from "zod";

export function normalizeWorkAreaName(name: string): string {
    return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export class PmoWorkAreaRequiredError extends Error {
    constructor() {
        super("Move or remove external actions before clearing the work area");
        this.name = "PmoWorkAreaRequiredError";
    }
}

export function assertCanClearParentWorkArea(workAreaId: string | null, externalActionCount: number): void {
    if (workAreaId === null && externalActionCount > 0) throw new PmoWorkAreaRequiredError();
}

export const workAreaInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable().default(null),
    displayOrder: z.number().int().min(0).max(10_000).default(0),
}).strict();

export const workAreaPatchSchema = workAreaInputSchema.partial().extend({
    isArchived: z.boolean().optional(),
}).strict();
