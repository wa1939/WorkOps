import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

/**
 * Returns the current user's most-recently-touched tasks — created, assigned,
 * or commented on — for the CommandPalette "Recent" section.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    const tasks = await prisma.task.findMany({
        where: {
            OR: [
                { createdById: userId },
                { assignments: { some: { userId } } },
            ],
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            project: { select: { name: true } },
        },
    });

    return NextResponse.json({ tasks });
}
