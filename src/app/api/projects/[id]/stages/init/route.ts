import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { DEFAULT_PROJECT_STAGES } from "@/lib/project-stages";

/**
 * Bootstrap the five default pipeline stages for a project.
 * POST, session-authed. 409 if the project already has any stages.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        if (!(await authorize(session.user, "project:manage", { kind: "project", id }))) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        const project = await prisma.project.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!project) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        const existing = await prisma.projectStage.count({ where: { projectId: id } });
        if (existing > 0) {
            return NextResponse.json({ error: "Stages already exist" }, { status: 409 });
        }

        await prisma.projectStage.createMany({
            data: DEFAULT_PROJECT_STAGES.map((s) => ({
                projectId: id,
                name: s.name,
                color: s.color,
                order: s.order,
            })),
        });

        const stages = await prisma.projectStage.findMany({
            where: { projectId: id },
            orderBy: { order: "asc" },
        });

        return NextResponse.json({ stages });
    } catch (error) {
        console.error("POST /api/projects/[id]/stages/init error:", error);
        return NextResponse.json({ error: "Failed to create stages" }, { status: 500 });
    }
}
