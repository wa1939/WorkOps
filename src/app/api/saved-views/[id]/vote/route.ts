import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { SavedViewCommandError, voteSavedView } from "@/lib/saved-views/commands";

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const actor = { id: session.user.id, role: session.user.role as any, departmentIds: [] };
        const result = await voteSavedView(id, actor);
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof SavedViewCommandError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("POST /api/saved-views/[id]/vote error:", error);
        return NextResponse.json({ error: "Failed to toggle vote" }, { status: 500 });
    }
}
