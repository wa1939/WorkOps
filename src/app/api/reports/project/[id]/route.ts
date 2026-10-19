import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { loadProjectReport, buildProjectReport } from "@/lib/reports/project-report";

export async function GET(
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
        return NextResponse.json(buildProjectReport(project));
    } catch (error) {
        console.error("Failed to fetch project report", error);
        return NextResponse.json({ error: "Failed to fetch project report" }, { status: 500 });
    }
}
