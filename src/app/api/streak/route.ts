import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { computeStreak } from "@/lib/streak";

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Derived from completion history — see src/lib/streak.ts for why the stored
        // UserStreak counter is no longer the source of truth.
        const completions = await prisma.task.findMany({
            where: {
                assignments: { some: { userId: session.user.id } },
                status: "DONE",
                doneAt: { not: null },
            },
            select: { doneAt: true },
            orderBy: { doneAt: "desc" },
            take: 2000,
        });

        const summary = computeStreak(
            completions.map((c) => c.doneAt!),
            new Date(),
        );

        return NextResponse.json(summary);
    } catch (error) {
        console.error("GET /api/streak error:", error);
        return NextResponse.json({ error: "Failed to fetch streak" }, { status: 500 });
    }
}

export async function POST() {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);

        const existing = await prisma.userStreak.findUnique({
            where: { userId: session.user.id },
        });

        if (!existing) {
            const created = await prisma.userStreak.create({
                data: {
                    userId: session.user.id,
                    currentStreak: 1,
                    bestStreak: 1,
                    lastActiveAt: now,
                    totalPoints: 1,
                },
            });
            return NextResponse.json(created);
        }

        if (existing.lastActiveAt) {
            const lastStr = existing.lastActiveAt.toISOString().slice(0, 10);

            if (lastStr === todayStr) {
                return NextResponse.json(existing);
            }

            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().slice(0, 10);

            if (lastStr === yesterdayStr) {
                const newStreak = existing.currentStreak + 1;
                const updated = await prisma.userStreak.update({
                    where: { userId: session.user.id },
                    data: {
                        currentStreak: newStreak,
                        bestStreak: Math.max(newStreak, existing.bestStreak),
                        lastActiveAt: now,
                        totalPoints: existing.totalPoints + 1,
                    },
                });
                return NextResponse.json(updated);
            }
        }

        const updated = await prisma.userStreak.update({
            where: { userId: session.user.id },
            data: {
                currentStreak: 1,
                bestStreak: Math.max(1, existing.bestStreak),
                lastActiveAt: now,
                totalPoints: existing.totalPoints + 1,
            },
        });
        return NextResponse.json(updated);
    } catch (error) {
        console.error("POST /api/streak error:", error);
        return NextResponse.json({ error: "Failed to update streak" }, { status: 500 });
    }
}
