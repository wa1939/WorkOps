import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMyLeave, updateLeaveRequest, LeaveCommandError } from "@/lib/leave/commands";
import { updateLeaveSchema } from "@/lib/leave/schemas";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const leave = await getMyLeave(undefined, { id: session.user.id, role: (session.user as any).role ?? "MEMBER" }, id);
    return NextResponse.json(leave);
  } catch (error) {
    if (error instanceof LeaveCommandError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "Leave operation failed" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const input = updateLeaveSchema.parse({ ...(await request.json()), id });
    const leave = await updateLeaveRequest(undefined, { id: session.user.id, role: (session.user as any).role ?? "MEMBER" }, input);
    return NextResponse.json(leave);
  } catch (error) {
    if (error instanceof LeaveCommandError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof Error && "issues" in error) return NextResponse.json({ error: (error as any).issues }, { status: 400 });
    return NextResponse.json({ error: "Leave operation failed" }, { status: 500 });
  }
}
