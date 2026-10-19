import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markRead, NotificationCommandError } from "@/lib/notifications/commands";
const actor = (user: any) => ({ id: user.id, role: user.role, departmentIds: user.departmentIds ?? [] });
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(await markRead((await params).id, actor(session.user)));
  } catch (error) {
    if (error instanceof NotificationCommandError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("POST /api/notifications/[id]/read error:", error);
    return NextResponse.json({ error: "Failed to mark as read" }, { status: 500 });
  }
}
