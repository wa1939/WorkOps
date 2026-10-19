import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { taskScopeForActor, type TaskActor } from "@/lib/tasks/authorization";
import type { Prisma, TaskStatus } from "@prisma/client";

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const role = session.user.role;
        const actor: TaskActor = {
            id: typeof session.user.id === "string" ? session.user.id : "",
            role: role === "ADMIN" || role === "LEAD" || role === "VIEWER" ? role : "MEMBER",
        };
        const tasks = await prisma.task.findMany({
            where: taskScopeForActor(actor) as Prisma.TaskWhereInput,
            include: {
                assignments: { include: { user: { select: { name: true } } } },
                project: { select: { name: true } },
                caseStudy: { select: { name: true } },
                tags: { include: { tag: { select: { name: true } } } },
            },
            orderBy: { createdAt: "desc" },
            take: 500,
        });

        const headers = ["Title", "Status", "Priority", "Assignees", "Project", "Due Date", "Tags", "Created"];
        const rows = tasks.map((t) => [
            `"${(t.title || "").replace(/"/g, '""')}"`,
            t.status,
            t.priority || "",
            `"${t.assignments.map((a) => a.user.name).join(", ")}"`,
            `"${t.project?.name || t.caseStudy?.name || ""}"`,
            t.dueAt ? new Date(t.dueAt).toISOString().split("T")[0] : "",
            `"${t.tags.map((tt) => tt.tag.name).join(", ")}"`,
            new Date(t.createdAt).toISOString().split("T")[0],
        ]);

        const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

        return new NextResponse(csv, {
            headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": `attachment; filename="tasks-${new Date().toISOString().split("T")[0]}.csv"`,
            },
        });
    } catch (error) {
        console.error("GET /api/tasks/export error:", error);
        return NextResponse.json({ error: "Failed to export tasks" }, { status: 500 });
    }
}
