import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";

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
        const actor = { id: session.user.id, role: typeof session.user.role === "string" ? session.user.role : null };
        if (!(await authorize(actor, "task:view", { kind: "task", id }))) {
            return NextResponse.json({ error: "Task not found" }, { status: 404 });
        }
        const result = await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({ where: { id }, include: { assignments: true, createdBy: true } });
            if (!task) return { kind: "missing" as const };
            if (task.type === "EXTERNAL_ACTION") return { kind: "pmo" as const };
            if (task.assignments.some((assignment) => assignment.userId === session.user.id)) {
                return { kind: "assigned" as const };
            }
            await tx.taskAssignment.create({
                data: {
                    taskId: id,
                    userId: session.user.id,
                },
            });
            await tx.auditLog.create({
                data: {
                    entityType: "task",
                    entityId: id,
                    action: "claim",
                    actorId: session.user.id,
                    taskId: id,
                    metaJson: JSON.stringify({ claimedBy: session.user.id }),
                },
            });
            return { kind: "claimed" as const, task };
        }, { isolationLevel: "Serializable" });
        if (result.kind === "missing") return NextResponse.json({ error: "Task not found" }, { status: 404 });
        if (result.kind === "pmo") return NextResponse.json({ error: "PMO external actions cannot be claimed" }, { status: 409 });
        if (result.kind === "assigned") return NextResponse.json({ error: "Already assigned" }, { status: 400 });
        const task = result.task;

        // Notify creator and managers
        const managers = await prisma.user.findMany({
            where: { role: "MANAGER", isActive: true },
        });

        const notifyUserIds = [
            ...(task.createdById ? [task.createdById] : []),
            ...managers.map((m) => m.id),
        ].filter((id) => id !== session.user.id);

        if (notifyUserIds.length > 0) {
            await prisma.notification.createMany({
                data: notifyUserIds.map((userId) => ({
                    userId,
                    type: "task_claimed",
                    title: "Task Claimed",
                    body: `${session.user.name} claimed the task: ${task.title}`,
                    linkUrl: `/tasks/${id}`,
                })),
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("POST /api/tasks/[id]/claim error:", error);
        return NextResponse.json({ error: "Failed to claim task" }, { status: 500 });
    }
}
