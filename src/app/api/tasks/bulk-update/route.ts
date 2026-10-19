import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { updateTaskStatus, cancelCreatedTasks, deleteTasks, findPmoBlockedTaskIds, TaskCommandError } from "@/lib/tasks/commands";
const schema = z.object({ taskIds: z.array(z.string()).min(1).max(100), action: z.enum(["status", "delete", "cancel"]), status: z.enum(["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"]).optional() });
const actor = (u: any) => ({ id: u.id, role: u.role ?? "MEMBER" });
export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const data = schema.parse(await request.json());
        const a = actor(session.user);
        const rejectedIds = await findPmoBlockedTaskIds(data.taskIds, prisma);
        if (rejectedIds.length) return NextResponse.json({ error: "PMO external actions must use the PMO workflow", rejectedIds }, { status: 409 });
        if (data.action === "cancel") return NextResponse.json(await cancelCreatedTasks(data.taskIds, a, prisma));
        if (data.action === "delete") {
            const { count } = await deleteTasks(data.taskIds, a, prisma);
            return NextResponse.json({ success: true, message: `${count} task(s) deleted` });
        }
        if (data.action === "status" && data.status) {
            const results = await prisma.$transaction(async (tx: any) => {
                const updates: Array<{ id: string; ok: true; data: unknown }> = [];
                for (const id of data.taskIds) updates.push({ id, ok: true, data: await updateTaskStatus(id, data.status!, a, tx) });
                return updates;
            }, { isolationLevel: "Serializable" });
            return NextResponse.json({ success: true, message: `${results.length} task(s) updated to ${data.status}`, results });
        }
        return NextResponse.json({ error: "status is required" }, { status: 400 });
    } catch (e) {
        if (e instanceof TaskCommandError) return NextResponse.json({ error: e.message }, { status: e.status });
        if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 });
        console.error("POST /api/tasks/bulk-update error:", e);
        return NextResponse.json({ error: "Failed to update tasks" }, { status: 500 });
    }
}
