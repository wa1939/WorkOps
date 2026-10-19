import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import type { AuthzUser } from "@/lib/authz/types";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const actor: AuthzUser = {
            id: session.user.id,
            role: typeof session.user.role === "string" ? session.user.role : null,
        };
        if (!(await authorize(actor, "project:view", { kind: "project", id }))) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        const [tasks, stages] = await Promise.all([
            prisma.task.findMany({
                where: { projectId: id, archived: false },
                orderBy: [{ stageId: "asc" }, { siblingOrder: "asc" }, { createdAt: "asc" }],
                select: {
                    id: true,
                    title: true,
                    status: true,
                    manualProgress: true,
                    plannedStartAt: true,
                    plannedEndAt: true,
                    startAt: true,
                    dueAt: true,
                    stageId: true,
                    stage: { select: { id: true, name: true, order: true, color: true } },
                    assignments: { select: { id: true, userId: true } },
                    dependencies: { select: { id: true, dependsOnId: true } },
                },
            }),
            prisma.projectStage.findMany({
                where: { projectId: id },
                orderBy: { order: "asc" },
                select: { id: true, name: true, order: true, color: true },
            }),
        ]);

        return NextResponse.json({ tasks, stages });
    } catch (error) {
        console.error("GET /api/projects/[id]/roadmap error:", error);
        return NextResponse.json({ error: "Failed to fetch project roadmap" }, { status: 500 });
    }
}
