import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writePmoAudit } from "@/lib/pmo/audit";
import {
  canManageWorkAreas,
  PmoForbiddenError,
} from "@/lib/pmo/authorization";
import {
  deleteEmptyWorkArea,
  PmoWorkAreaInUseError,
  PmoWorkAreaNotFoundError,
} from "@/lib/pmo/work-area-service";
import { normalizeWorkAreaName, workAreaPatchSchema } from "@/lib/pmo/work-areas";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isActive: true, role: true } });
    if (!actor?.isActive) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canManageWorkAreas({ id: session.user.id, role: actor.role })) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    try {
        const { id } = await params;
        const input = workAreaPatchSchema.parse(await request.json());
        const area = await prisma.$transaction(async (tx) => {
            const updated = await tx.workArea.update({
                where: { id },
                data: { ...input, normalizedName: input.name ? normalizeWorkAreaName(input.name) : undefined },
            });
            await writePmoAudit(tx, {
                entityType: "work_area", entityId: id, action: input.isArchived === true ? "archive" : input.isArchived === false ? "reactivate" : "update",
                actorId: session.user.id, changes: { fields: Object.keys(input) },
            });
            return updated;
        });
        const counts = await prisma.workArea.findUnique({ where: { id }, include: { _count: { select: { projects: true, caseStudies: true } } } });
        return NextResponse.json({ ...area, projectCount: counts?._count.projects ?? 0, caseStudyCount: counts?._count.caseStudies ?? 0 });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return NextResponse.json({ error: "A work area with this name already exists" }, { status: 409 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
            return NextResponse.json({ error: "Work area not found" }, { status: 404 });
        }
        if (error instanceof Error && error.name === "ZodError") return NextResponse.json({ error: "Invalid work area" }, { status: 400 });
        throw error;
    }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true, role: true },
  });
  if (!actor?.isActive) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const deleted = await deleteEmptyWorkArea(
      id,
      { id: session.user.id, role: actor.role },
      prisma,
    );
    return NextResponse.json({ id: deleted.id });
  } catch (error) {
    if (error instanceof PmoForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof PmoWorkAreaNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof PmoWorkAreaInUseError) {
      return NextResponse.json(
        {
          error: error.message,
          projectCount: error.projectCount,
          caseStudyCount: error.caseStudyCount,
          recommendation: "archive",
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
