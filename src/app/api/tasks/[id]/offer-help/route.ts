import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";

export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: taskId } = await params;
        const actor = { id: session.user.id, role: typeof session.user.role === "string" ? session.user.role : null };
        if (!(await authorize(actor, "task:view", { kind: "task", id: taskId }))) {
            return NextResponse.json({ error: "Task not found" }, { status: 404 });
        }
        const userId = session.user.id;

        // Check if task exists
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            include: {
                assignments: true,
                supportRequests: { where: { status: "Open" } },
            },
        });

        if (!task) {
            return NextResponse.json({ error: "Task not found" }, { status: 404 });
        }

        // Check if user is already assigned
        const alreadyAssigned = task.assignments.some(a => a.userId === userId);
        if (alreadyAssigned) {
            return NextResponse.json({ error: "You are already assigned to this task" }, { status: 400 });
        }

        // Add user as assignee
        await prisma.taskAssignment.create({
            data: {
                taskId,
                userId,
            },
        });

        // Close all open support requests for this task
        if (task.supportRequests.length > 0) {
            await prisma.supportRequest.updateMany({
                where: {
                    taskId,
                    status: "Open",
                },
                data: {
                    status: "Resolved",
                },
            });
        }

        // Create notification for task owner(s)
        const ownerAssignments = task.assignments.filter(a => a.userId !== userId);
        for (const owner of ownerAssignments) {
            await prisma.notification.create({
                data: {
                    userId: owner.userId,
                    type: "team",
                    title: "Someone offered help!",
                    body: `${session.user.name} offered to help with "${task.title}"`,
                },
            });
        }

        return NextResponse.json({ success: true, message: "You are now assigned to help with this task" });
    } catch (error) {
        console.error("POST /api/tasks/[id]/offer-help error:", error);
        return NextResponse.json({ error: "Failed to offer help" }, { status: 500 });
    }
}
