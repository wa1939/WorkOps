import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";

/**
 * Duplicate a task. Copies title (+ "(Copy)"), description, priority, dueAt,
 * effortHours, projectId, caseStudyId, kpiId, tags, and assignees. Resets
 * status to TODO and creates a fresh id.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const actor = { id: session.user.id, role: typeof session.user.role === "string" ? session.user.role : null };
    if (!(await authorize(actor, "task:view", { kind: "task", id }))) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const result = await prisma.$transaction(async (tx) => {
        const original = await tx.task.findUnique({ where: { id }, include: { assignments: true, tags: true } });
        if (!original) return { kind: "missing" as const };
        if (original.type === "EXTERNAL_ACTION") return { kind: "pmo" as const };
        const duplicate = await tx.task.create({ data: {
            title: original.title.endsWith("(Copy)") ? original.title : `${original.title} (Copy)`,
            description: original.description,
            status: "TODO",
            priority: original.priority,
            dueAt: original.dueAt,
            dueAtEnd: original.dueAtEnd,
            effortHours: original.effortHours,
            projectId: original.projectId,
            caseStudyId: original.caseStudyId,
            kpiId: original.kpiId,
            createdById: session.user.id,
            isPrivate: original.isPrivate,
            assignments: original.assignments.length
                ? { create: original.assignments.map((a) => ({ userId: a.userId })) }
                : undefined,
            tags: original.tags.length
                ? { create: original.tags.map((t) => ({ tagId: t.tagId })) }
                : undefined,
            }, select: { id: true, title: true } });
        return { kind: "created" as const, duplicate };
    }, { isolationLevel: "Serializable" });
    if (result.kind === "missing") return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (result.kind === "pmo") return NextResponse.json({ error: "PMO external actions cannot be duplicated" }, { status: 409 });

    return NextResponse.json({ ok: true, task: result.duplicate });
}
