import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { elapsedMinutes } from "@/lib/time/tracker";

export async function GET(): Promise<Response> {
    try {
        const session = await auth();
        const user = session?.user as { id?: unknown } | undefined;
        if (!user || typeof user.id !== "string" || user.id.length === 0) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const now = new Date();
        const activeTimer = await prisma.activeTimer.findUnique({ where: { userId: user.id } });
        if (!activeTimer) return NextResponse.json(null);

        return NextResponse.json({
            taskId: activeTimer.taskId,
            startedAt: activeTimer.startedAt.toISOString(),
            elapsedMinutes: elapsedMinutes(activeTimer.startedAt, now),
        });
    } catch (error) {
        console.error("Failed to fetch active timer", error);
        return NextResponse.json({ error: "Failed to fetch active timer" }, { status: 500 });
    }
}
