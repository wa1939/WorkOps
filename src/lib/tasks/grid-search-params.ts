import type { TaskGridInput } from "@/lib/tasks/grid-query";
import { taskGridInputSchema } from "@/lib/tasks/grid-query";

function values(params: URLSearchParams, name: string, singular?: string): string[] | undefined {
    const multi = params.getAll(name);
    if (multi.length > 0) return multi.flatMap((value) => value.split(",")).map((v) => v.trim());
    const single = singular ? params.get(singular) : null;
    if (single) return [single];
    return undefined;
}

function optionalValue(params: URLSearchParams, name: string): string | undefined {
    const value = params.get(name);
    return value === null || value === "" ? undefined : value;
}

function booleanValue(params: URLSearchParams, name: string): boolean | undefined {
    const value = params.get(name);
    if (value === null) return undefined;
    return value === "true" || value === "1";
}

function cursorValue(raw: string | null): unknown {
    if (raw === null) return undefined;
    try {
        return JSON.parse(raw);
    } catch {
        // Passing the raw value through lets Zod return the normal 400 shape.
        return raw;
    }
}

/** Parse and validate /api/tasks/grid query params. Kept outside the route
 * file because Next.js route modules may only export handlers and config. */
export function parseTaskGridSearchParams(params: URLSearchParams): TaskGridInput {
    return taskGridInputSchema.parse({
        filters: {
            status: values(params, "status"),
            priority: values(params, "priority"),
            assigneeIds: values(params, "assigneeIds", "assigneeId"),
            tagIds: values(params, "tagIds", "tagId"),
            projectId: optionalValue(params, "projectId"),
            projectIds: values(params, "projectIds"),
            workspaceId: optionalValue(params, "workspaceId"),
            search: optionalValue(params, "search"),
            includeArchived: booleanValue(params, "includeArchived"),
            dueBefore: optionalValue(params, "dueBefore"),
            dueAfter: optionalValue(params, "dueAfter"),
        },
        groupBy: optionalValue(params, "groupBy"),
        sortBy: optionalValue(params, "sortBy"),
        dir: optionalValue(params, "dir"),
        cursor: cursorValue(params.get("cursor")),
    });
}
