import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getWeeklyReportForActor } from "@/lib/reports/commands";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const report = await getWeeklyReportForActor(id, { id: session.user.id!, role: session.user.role as any, departmentIds: [] });
    return NextResponse.json(report);
  } catch (error: any) {
    const status = error?.status ?? 500;
    if (status !== 500) return NextResponse.json({ error: error.message }, { status });
    console.error("GET /api/weekly-reports/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch report" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Only admins can delete reports" }, { status: 403 });
    const { id } = await params;
    await prisma.weeklyReport.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/weekly-reports/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete report" }, { status: 500 });
  }
}
