import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { currentRiyadhWeekWindow } from "@/lib/week";
import {
    selectNudgeTargets,
    buildNudgeCopy,
    NUDGE_TYPE,
    NUDGE_LINK,
    type NudgeCandidate,
} from "@/lib/close-nudge";
import { sendCloseNudgeEmail } from "@/lib/email";

export const maxDuration = 60;

/** Thursday-afternoon nudge: active users who closed nothing this week and
 *  aren't on leave get an in-app notification + email pointing them at Sabah's
 *  record-my-week flow. Idempotent per user per week. */

async function gatherCandidates(now: Date) {
    const window = currentRiyadhWeekWindow(now);
    const recordingWindow = {
        weekStart: new Date(window.weekStart.getTime() - 7 * 24 * 60 * 60 * 1000),
        weekEnd: window.weekStart,
    };
    const users = await prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true, email: true, quietUntil: true, createdAt: true },
    });

    const candidates: NudgeCandidate[] = await Promise.all(
        users.map(async (u) => {
            const [
                createdTaskCount,
                completedTaskCount,
                progressCommentCount,
                doneThisWeek,
                leaves,
                nudged,
            ] = await Promise.all([
                prisma.task.count({
                    where: {
                        createdById: u.id,
                        createdAt: { gte: recordingWindow.weekStart, lt: recordingWindow.weekEnd },
                    },
                }),
                prisma.task.count({
                    where: {
                        assignments: { some: { userId: u.id } },
                        status: "DONE",
                        doneAt: { gte: recordingWindow.weekStart, lt: recordingWindow.weekEnd },
                    },
                }),
                prisma.comment.count({
                    where: {
                        authorId: u.id,
                        body: { not: "" },
                        createdAt: { gte: recordingWindow.weekStart, lt: recordingWindow.weekEnd },
                        task: { assignments: { some: { userId: u.id } } },
                    },
                }),
                prisma.task.count({
                    where: {
                        assignments: { some: { userId: u.id } },
                        status: "DONE",
                        doneAt: { gte: window.weekStart, lte: now },
                    },
                }),
                prisma.leaveRequest.findMany({
                    where: {
                        userId: u.id,
                        status: "Approved",
                        startAt: { lt: recordingWindow.weekEnd },
                        endAt: { gte: recordingWindow.weekStart },
                    },
                    select: { startAt: true, endAt: true },
                }),
                prisma.notification.count({
                    where: { userId: u.id, type: NUDGE_TYPE, createdAt: { gte: window.weekStart } },
                }),
            ]);
            return {
                ...u,
                doneThisWeek,
                recordingActivity: { createdTaskCount, completedTaskCount, progressCommentCount },
                recordingWindow,
                leaves,
                alreadyNudgedThisWeek: nudged > 0,
            };
        }),
    );
    return { candidates, window };
}

async function runNudge(dry: boolean) {
    const now = new Date();
    const { candidates, window } = await gatherCandidates(now);
    const targets = selectNudgeTargets(candidates, window, now);

    if (dry) {
        return {
            dry: true,
            candidates: candidates.length,
            targets: targets.map((t) => ({ name: t.name, email: t.email })),
        };
    }

    let emailed = 0;
    for (const t of targets) {
        const copy = buildNudgeCopy(t.name);
        await prisma.notification.create({
            data: { userId: t.id, type: NUDGE_TYPE, title: copy.title, body: copy.body, linkUrl: NUDGE_LINK },
        });
        try {
            await sendCloseNudgeEmail({ email: t.email, name: t.name, ...copy });
            emailed++;
        } catch (e) {
            console.error(`close-nudge email failed for ${t.email}:`, (e as Error).message);
        }
    }
    return { dry: false, candidates: candidates.length, notified: targets.length, emailed };
}

export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        return NextResponse.json({ success: true, ...(await runNudge(false)) });
    } catch (error) {
        console.error("GET /api/cron/weekly-close-nudge error:", error);
        return NextResponse.json({ error: (error as Error).message || "Failed" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
        const dry = new URL(request.url).searchParams.get("dry") === "true";
        return NextResponse.json({ success: true, ...(await runNudge(dry)) });
    } catch (error) {
        console.error("POST /api/cron/weekly-close-nudge error:", error);
        return NextResponse.json({ error: (error as Error).message || "Failed" }, { status: 500 });
    }
}
