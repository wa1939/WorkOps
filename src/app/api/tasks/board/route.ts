import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
    buildTaskGridQuery,
    type TaskGridInput,
} from "@/lib/tasks/grid-query";
import { parseTaskGridSearchParams } from "@/lib/tasks/grid-search-params";

const BOARD_PAGE_SIZE = 500;

const boardTaskSelect = {
    id: true,
    taskKey: true,
    title: true,
    status: true,
    priority: true,
    dueAt: true,
    assignments: {
        select: {
            user: {
                select: {
                    id: true,
                    name: true,
                    image: true,
                },
            },
        },
    },
    dependencies: {
        select: {
            dependsOn: {
                select: {
                    id: true,
                    taskKey: true,
                    status: true,
                },
            },
        },
    },
    subtasks: {
        select: { status: true },
    },
} satisfies Prisma.TaskSelect;

type SessionUser = {
    id?: unknown;
    role?: unknown;
    departmentIds?: unknown;
};

type BoardTaskRow = Prisma.TaskGetPayload<{ select: typeof boardTaskSelect }>;

function sessionViewer(user: SessionUser): {
    id: string;
    role: string;
    departmentIds: string[];
} | null {
    if (typeof user.id !== "string" || user.id.length === 0) return null;
    return {
        id: user.id,
        role: typeof user.role === "string" && user.role.length > 0 ? user.role : "MEMBER",
        departmentIds: Array.isArray(user.departmentIds)
            ? user.departmentIds.filter((id): id is string => typeof id === "string")
            : [],
    };
}

function boardInput(request: Request): TaskGridInput {
    const parsed = parseTaskGridSearchParams(new URL(request.url).searchParams);
    return {
        ...parsed,
        groupBy: "none",
        cursor: undefined,
    };
}

function toBoardTask(row: BoardTaskRow) {
    return {
        id: row.id,
        taskKey: row.taskKey,
        title: row.title,
        status: row.status,
        priority: row.priority,
        dueDate: row.dueAt?.toISOString() ?? null,
        assignees: row.assignments.map((assignment) => assignment.user),
        dependencies: row.dependencies,
        subtaskCount: row.subtasks.length,
        completedSubtasks: row.subtasks.filter((subtask) => subtask.status === "DONE").length,
    };
}

export async function GET(request: Request): Promise<Response> {
    try {
        const session = await auth();
        const viewer = sessionViewer((session?.user ?? {}) as SessionUser);
        if (!viewer) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const query = buildTaskGridQuery(boardInput(request), viewer);
        const rows = await prisma.task.findMany({
            where: query.where,
            orderBy: query.orderBy,
            take: BOARD_PAGE_SIZE,
            select: boardTaskSelect,
        });

        return NextResponse.json({ tasks: rows.map(toBoardTask) });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error("Failed to fetch task board", error);
        return NextResponse.json({ error: "Failed to fetch task board" }, { status: 500 });
    }
}
