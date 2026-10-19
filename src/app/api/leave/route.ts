import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createLeaveRequest, listMyLeave, LeaveCommandError } from "@/lib/leave/commands";
import { leavePayloadSchema, leaveSearchSchema } from "@/lib/leave/schemas";

function errorResponse(error: unknown) {
  if (error instanceof LeaveCommandError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof Error && "issues" in error) return NextResponse.json({ error: (error as any).issues }, { status: 400 });
  return NextResponse.json({ error: "Leave operation failed" }, { status: 500 });
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(request.url);
    const input = leaveSearchSchema.parse({ query: url.searchParams.get("query") ?? undefined, status: url.searchParams.get("status") ?? undefined, limit: Number(url.searchParams.get("limit") ?? 50) });
    return NextResponse.json(await listMyLeave(undefined, { id: session.user.id, role: (session.user as any).role ?? "MEMBER" }, input));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = leavePayloadSchema.parse(await request.json());
    const leave = await createLeaveRequest(undefined, { id: session.user.id, role: (session.user as any).role ?? "MEMBER" }, input);
    return NextResponse.json(leave, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
