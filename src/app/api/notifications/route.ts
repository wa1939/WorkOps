import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listMine, markOwnRead, NotificationCommandError } from "@/lib/notifications/commands";

export const dynamic = "force-dynamic";
const actor = (user: any) => ({ id: user.id, role: user.role, departmentIds: user.departmentIds ?? [] });
const markReadInput = z.object({
    ids: z.array(z.string().min(1).max(128)).max(100).optional(),
});

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const raw = new URL(request.url).searchParams.get("limit");
    if (raw !== null && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))) {
      return NextResponse.json({ error: "Invalid notification limit", code: "INVALID_LIMIT" }, { status: 400 });
    }
    return NextResponse.json(await listMine({ limit: raw === null ? undefined : Number(raw) }, actor(session.user)));
  } catch (error) {
    console.error("GET /api/notifications error:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

async function markRead(request: Request, method: "PATCH" | "PUT") {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // An empty request means mark all of the current user's notifications read.
    }
    const input = markReadInput.parse(body);
    return NextResponse.json(await markOwnRead(session.user.id, input.ids));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid notification ids", code: "INVALID_IDS" }, { status: 400 });
    }
    if (error instanceof NotificationCommandError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error(`${method} /api/notifications error:`, error);
    return NextResponse.json({ error: "Failed to mark notifications as read" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  return markRead(request, "PATCH");
}

/** Compatibility alias for clients that used PUT while the route was read-only. */
export async function PUT(request: Request) {
  return markRead(request, "PUT");
}
