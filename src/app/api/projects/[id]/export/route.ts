import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        if (!(await authorize(session.user, "project:view", { kind: "project", id }))) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        const project = await prisma.project.findUnique({
            where: { id },
            include: {
                tasks: {
                    include: {
                        assignments: { include: { user: true } },
                        tags: { include: { tag: true } },
                    },
                    orderBy: { createdAt: "asc" },
                },
            },
        });

        if (!project) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        // Generate CSV
        const headers = ["Title", "Status", "Priority", "Assignees", "Due Date", "Effort (hours)", "Tags", "Description"];
        const rows = project.tasks.map((task) => [
            task.title,
            task.status,
            task.priority,
            task.assignments.map((a) => a.user.name).join("; "),
            task.dueAt ? new Date(task.dueAt).toLocaleDateString() : "",
            task.effortHours?.toString() || "",
            task.tags.map((t) => t.tag.name).join("; "),
            task.description || "",
        ]);

        const csvContent = [
            headers.join(","),
            ...rows.map((row) =>
                row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
            ),
        ].join("\n");

        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": `attachment; filename="${project.name.replace(/[^a-z0-9]/gi, "_")}_tasks.csv"`,
            },
        });
    } catch (error) {
        console.error("GET /api/projects/[id]/export error:", error);
        return NextResponse.json({ error: "Failed to export project" }, { status: 500 });
    }
}
