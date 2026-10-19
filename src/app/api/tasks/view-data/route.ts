import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
    buildTaskGridQuery,
    type TaskGridRow,
} from "@/lib/tasks/grid-query";
import {
    MAX_VIEW_TASK_OFFSET,
    normalizeViewTaskQuery,
    parseViewTaskSearchParams,
} from "@/lib/view-task-query";

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

function normalizeRow(row: TaskGridRow) {
    return {
        ...row,
        dueDate: row.dueAt ?? row.dueDate ?? null,
    };
}

export async function GET(request: Request): Promise<Response> {
    try {
        const session = await auth();
        const viewer = sessionViewer((session?.user ?? {}) as SessionUser);
        if (!viewer) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { input, offset } = normalizeViewTaskQuery(
            parseViewTaskSearchParams(new URL(request.url).searchParams),
            viewer.id,
            new Date(),
        );
        const query = buildTaskGridQuery(input, viewer);
        const [totalCount, fetchedRows] = await Promise.all([
            prisma.task.count({ where: query.where }),
            prisma.task.findMany({
                where: query.where,
                orderBy: query.orderBy,
                include: query.include,
                skip: offset,
                take: PAGE_SIZE + 1,
            }),
        ]);

        const hasNext = fetchedRows.length > PAGE_SIZE;
        const rows = (fetchedRows.slice(0, PAGE_SIZE) as unknown as TaskGridRow[]).map(normalizeRow);
        return NextResponse.json({
            rows,
            totalCount,
            nextOffset: hasNext && offset + rows.length <= MAX_VIEW_TASK_OFFSET ? offset + rows.length : null,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error(
            "Failed to fetch view task data",
            error instanceof Error ? error.name : "unknown error",
        );
        return NextResponse.json({ error: "Failed to fetch view task data" }, { status: 500 });
    }
}
