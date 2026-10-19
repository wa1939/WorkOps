import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writePmoAudit } from "@/lib/pmo/audit";
import { canManageWorkAreas } from "@/lib/pmo/authorization";
import { normalizeWorkAreaName, workAreaInputSchema } from "@/lib/pmo/work-areas";

export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isActive: true, role: true } });
    if (!actor?.isActive) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    if (includeArchived && actor.role !== "ADMIN" && actor.role !== "MANAGER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const areas = await prisma.workArea.findMany({
        where: includeArchived ? undefined : { isArchived: false },
        include: { _count: { select: { projects: true, caseStudies: true } } },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(areas.map(({ _count, ...area }) => ({
        ...area,
        projectCount: _count.projects,
        caseStudyCount: _count.caseStudies,
    })));
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isActive: true, role: true } });
    if (!actor?.isActive) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canManageWorkAreas({ id: session.user.id, role: actor.role })) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    try {
        const input = workAreaInputSchema.parse(await request.json());
        const area = await prisma.$transaction(async (tx) => {
            const created = await tx.workArea.create({
                data: { ...input, normalizedName: normalizeWorkAreaName(input.name), createdById: session.user.id },
            });
            await writePmoAudit(tx, {
                entityType: "work_area", entityId: created.id, action: "create", actorId: session.user.id,
                changes: { fields: ["name", "description", "displayOrder"] },
            });
            return created;
        });
        return NextResponse.json({ ...area, projectCount: 0, caseStudyCount: 0 }, { status: 201 });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return NextResponse.json({ error: "A work area with this name already exists" }, { status: 409 });
        }
        if (error instanceof Error && error.name === "ZodError") {
            return NextResponse.json({ error: "Invalid work area" }, { status: 400 });
        }
        throw error;
    }
}
