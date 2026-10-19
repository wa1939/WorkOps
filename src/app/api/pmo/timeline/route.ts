import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { projectVisibilityWhere } from "@/lib/executive-summary";
import { prisma } from "@/lib/prisma";
import { SabahForbiddenError, toSabahActor } from "@/lib/sabah/auth/actor";

const STAGE_STATUSES = ["PLANNED", "ACTIVE", "COMPLETE", "BLOCKED"] as const;
type StageStatus = (typeof STAGE_STATUSES)[number];

type TimelineProjectRecord = {
    id: string;
    name: string;
    status: string;
    health: string;
    startAt: Date | null;
    dueAt: Date | null;
    dueAtEnd: Date | null;
    updatedAt: Date;
    stages: Array<{ status: StageStatus }>;
    tasks: Array<{ status: string }>;
};

function percentage(done: number, total: number): number {
    return total === 0 ? 0 : Math.round((done / total) * 100);
}

function stageProgress(stages: TimelineProjectRecord["stages"]) {
    const counts: Record<StageStatus, number> = {
        PLANNED: 0,
        ACTIVE: 0,
        COMPLETE: 0,
        BLOCKED: 0,
    };
    for (const stage of stages) {
        counts[stage.status] += 1;
    }
    return {
        total: stages.length,
        planned: counts.PLANNED,
        active: counts.ACTIVE,
        complete: counts.COMPLETE,
        blocked: counts.BLOCKED,
        completed: counts.COMPLETE,
        percent: percentage(counts.COMPLETE, stages.length),
    };
}

function taskProgress(tasks: TimelineProjectRecord["tasks"]) {
    const done = tasks.filter((task) => task.status === "DONE").length;
    return { total: tasks.length, done, percent: percentage(done, tasks.length) };
}

function toTimelineProject(project: TimelineProjectRecord) {
    return {
        id: project.id,
        name: project.name,
        status: project.status,
        health: project.health,
        startAt: project.startAt?.toISOString() ?? null,
        dueAt: project.dueAt?.toISOString() ?? null,
        dueAtEnd: project.dueAtEnd?.toISOString() ?? null,
        updatedAt: project.updatedAt.toISOString(),
        stageProgress: stageProgress(project.stages),
        taskProgress: taskProgress(project.tasks),
    };
}

function dateBounds(projects: TimelineProjectRecord[]) {
    const dates = projects.flatMap((project) =>
        [project.startAt, project.dueAt, project.dueAtEnd].filter((date): date is Date => date !== null),
    );
    if (dates.length === 0) return { minDate: null, maxDate: null };
    return {
        minDate: new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString(),
        maxDate: new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString(),
    };
}

export async function GET() {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let actor;
    try {
        actor = await toSabahActor(session.user);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        throw error;
    }

    if (actor.role === "VIEWER") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        const projects = await prisma.project.findMany({
            where: projectVisibilityWhere(actor) as Prisma.ProjectWhereInput,
            select: {
                id: true,
                name: true,
                status: true,
                health: true,
                startAt: true,
                dueAt: true,
                dueAtEnd: true,
                updatedAt: true,
                stages: { select: { status: true } },
                tasks: { select: { status: true } },
            },
            orderBy: { name: "asc" },
        });
        const records = projects as TimelineProjectRecord[];
        return NextResponse.json({
            projects: records.map(toTimelineProject),
            ...dateBounds(records),
        });
    } catch (error) {
        console.error("GET /api/pmo/timeline error:", error);
        return NextResponse.json({ error: "Failed to fetch timeline" }, { status: 500 });
    }
}
