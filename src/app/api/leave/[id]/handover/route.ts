import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateHandover, LeaveCommandError } from "@/lib/leave/commands";
import { handoverPayloadSchema } from "@/lib/leave/schemas";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const input = handoverPayloadSchema.parse({ ...(await request.json()), id });
    const result = await updateHandover(undefined, { id: session.user.id, role: (session.user as any).role ?? "MEMBER" }, input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof LeaveCommandError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof Error && "issues" in error) return NextResponse.json({ error: (error as any).issues }, { status: 400 });
    return NextResponse.json({ error: "Leave operation failed" }, { status: 500 });
  }
}
