import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { buildAiUndoWhere } from "@/lib/pmo/task-mutation-policy";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
    taskIds: z.array(z.string()).min(1).max(30),
});

export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { taskIds } = bodySchema.parse(body);

        // Only cancel tasks the user created via AI, that are still in-flight,
        // and were created recently (last 6 hours — safety window)
        const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);

        const cancelIds = await prisma.$transaction(async (tx) => {
            const tasks = await tx.task.findMany({
                where: buildAiUndoWhere(taskIds, session.user.id, cutoff),
                select: { id: true },
            });
            const ids = tasks.map((task) => task.id);
            if (!ids.length) return ids;
            const updated = await tx.task.updateMany({
                where: buildAiUndoWhere(ids, session.user.id, cutoff),
                data: { status: "CANCELED", doneAt: null },
            });
            if (updated.count !== ids.length) throw new Error("Tasks changed during undo; retry the request");
            await tx.auditLog.createMany({
                data: tasks.map((task) => ({
                    entityType: "task",
                    entityId: task.id,
                    action: "ai:undo",
                    actorId: session.user.id,
                    taskId: task.id,
                    metaJson: JSON.stringify({ source: "ai-chat", reason: "user-undo" }),
                })),
            });
            return ids;
        }, { isolationLevel: "Serializable" });

        return NextResponse.json({
            canceledCount: cancelIds.length,
            canceledIds: cancelIds,
            skippedCount: taskIds.length - cancelIds.length,
        });
    } catch (error) {
        console.error("POST /api/ai/tasks/undo error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
        }
        return NextResponse.json({ error: "Failed to undo" }, { status: 500 });
    }
}
