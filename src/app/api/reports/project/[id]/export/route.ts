import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { buildProjectReport, loadProjectReport } from "@/lib/reports/project-report";

function safeFileName(name: string): string {
    return name.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "project";
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
    void request;
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { id } = await params;
        const allowed = await authorize(session.user, "project:view", { type: "project", id });
        if (!allowed) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }
        const project = await loadProjectReport(id);
        if (!project) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }
        const report = buildProjectReport(project);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet([
                ["Metric", "Value"],
                ["Project", report.project.name],
                ["Status", report.project.status],
                ["Tasks", report.summary.taskCount],
                ["Done %", report.summary.donePercent],
                ["Overdue", report.summary.overdueTaskCount],
                ["Estimated hours", report.summary.estimatedHours],
                ["Logged hours", report.summary.loggedHours],
                ["Variance hours", report.summary.varianceHours],
            ]),
            "Overview",
        );
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet([
                ["Member", "Email", "Role", "Logged hours", "Logged minutes", "Task count"],
                ...report.members.map((member) => [
                    member.memberName,
                    member.memberEmail,
                    member.role ?? "",
                    member.loggedHours,
                    member.loggedMinutes,
                    member.taskCount,
                ]),
            ]),
            "Members",
        );
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet([
                ["Task key", "Task", "Status", "Priority", "Estimate hours", "Logged hours", "Due", "Assignees"],
                ...report.tasks.map((task) => [
                    task.taskKey ?? "",
                    task.title,
                    task.status,
                    task.priority,
                    task.estimatedHours,
                    task.loggedHours,
                    task.dueAt ?? "",
                    task.assignments.map((assignment) => assignment.memberName).join("; "),
                ]),
            ]),
            "Tasks",
        );

        const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
        return new NextResponse(file, {
            status: 200,
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="${safeFileName(report.project.name)}_report.xlsx"`,
            },
        });
    } catch (error) {
        console.error("Failed to export project report", error);
        return NextResponse.json({ error: "Failed to export project report" }, { status: 500 });
    }
}
