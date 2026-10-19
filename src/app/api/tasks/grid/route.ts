import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
    buildTaskGridQuery,
    deriveGroups,
    taskGridInputSchema,
    type TaskGridInput,
    type TaskGridRow,
} from "@/lib/tasks/grid-query";
import { parseTaskGridSearchParams } from "@/lib/tasks/grid-search-params";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SessionUser = {
    id?: unknown;
    role?: unknown;
    departmentIds?: unknown;
};



function sessionViewer(user: SessionUser): { id: string; role: string; departmentIds: string[] } | null {
    if (typeof user.id !== "string" || user.id.length === 0) return null;
    return {
        id: user.id,
        role: typeof user.role === "string" && user.role.length > 0 ? user.role : "MEMBER",
        departmentIds: Array.isArray(user.departmentIds)
            ? user.departmentIds.filter((id): id is string => typeof id === "string")
            : [],
    };
}

export async function GET(request: Request): Promise<Response> {
    try {
        const session = await auth();
        const viewer = sessionViewer((session?.user ?? {}) as SessionUser);
        if (!viewer) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const input = parseTaskGridSearchParams(new URL(request.url).searchParams);
        const query = buildTaskGridQuery(input, viewer);
        const rows = await prisma.task.findMany({
            ...query,
            take: PAGE_SIZE,
        });
        const gridRows = rows as unknown as TaskGridRow[];
        const last = gridRows.at(-1);
        const nextCursor = rows.length === PAGE_SIZE && last
            ? { updatedAt: last.updatedAt.toISOString(), id: last.id }
            : null;

        // Normalize to the UI contract: dueAt -> dueDate, group summary
        // fields shaped as the grid components expect.
        const normalizedRows = gridRows.map((row) => ({
            ...row,
            dueDate: row.dueAt ?? row.dueDate ?? null,
        }));
        const normalizedGroups = deriveGroups(gridRows, input.groupBy).map((group) => ({
            key: group.key,
            label: group.label,
            count: group.count,
            doneCount: group.doneCount,
            overdueCount: group.overdueCount,
            estimateMinutesSum: group.estimateMinutes ?? 0,
            sampleAvatars: group.assigneeAvatars.map((url: string) => ({ id: url, name: null, image: url })),
        }));

        return NextResponse.json({
            rows: normalizedRows,
            groups: normalizedGroups,
            nextCursor,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error("Failed to fetch task grid", error);
        return NextResponse.json({ error: "Failed to fetch task grid" }, { status: 500 });
    }
}
