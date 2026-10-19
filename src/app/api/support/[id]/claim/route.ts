import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { claimSupportRequest } from "@/lib/support/commands";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const result = await claimSupportRequest(id, { id: session.user.id, role: (session.user.role ?? "MEMBER") as any });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("POST /api/support/[id]/claim error:", error);
    return NextResponse.json({ error: error?.message ?? "Failed to claim support request" }, { status: Number.isInteger(error?.status) ? error.status : 500 });
  }
}
