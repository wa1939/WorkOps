import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markAllRead } from "@/lib/notifications/commands";
const actor = (user: any) => ({ id: user.id, role: user.role, departmentIds: user.departmentIds ?? [] });
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(await markAllRead(actor(session.user)));
  } catch (error) {
    console.error("POST /api/notifications/read-all error:", error);
    return NextResponse.json({ error: "Failed to mark all as read" }, { status: 500 });
  }
}
