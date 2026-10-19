import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { sendSundayDigest } from "@/lib/email";
import {
    buildDigestPreview,
    saveDigestDraft,
    sendApprovedDigest,
    type DigestActorScopes,
    type DigestCounts,
    type DigestEmailSender,
    type DigestPreview,
} from "@/lib/communications/digest";
import { riyadhWeekWindow, formatWeekLabel } from "@/lib/week";
import { gatherWeekContext, gatherPromptExtras, generateExecutiveSummary } from "@/lib/executive-summary";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { configuredInternalDomains } from "@/lib/communications/domains";

export const maxDuration = 60;

/**
 * Composes and (optionally) delivers the Sunday executive digest, plus
 * per-teammate weekly summaries as in-app notifications.
 * - GET  → invoked by Vercel Cron. Requires Bearer ${CRON_SECRET}. Runs both.
 * - POST → invoked from the /reports page by an ADMIN ("Send now"). Personal
 *          summaries only when ?summaries=true (so test-sends don't spam).
 */

/**
 * Deterministic per-teammate weekly recap → in-app Notification. No GLM.
 * Respects User.quietUntil (skips snoozed users). Skips users with nothing to say.
 */
async function generatePersonalSummaries() {
    const now = new Date();
    const { weekStart, weekEnd } = riyadhWeekWindow(now);

    const users = await prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, quietUntil: true },
    });

    const notifications: { userId: string; type: string; title: string; body: string; linkUrl: string }[] = [];
    let skipped = 0;

    for (const user of users) {
        if (user.quietUntil && user.quietUntil > now) {
            skipped++;
            continue;
        }

        const [doneTasks, openTasks, upcoming] = await Promise.all([
            prisma.task.findMany({
                where: {
                    assignments: { some: { userId: user.id } },
                    status: "DONE",
                    doneAt: { gte: weekStart, lt: weekEnd },
                },
                select: { title: true },
                orderBy: { doneAt: "desc" },
                take: 3,
            }),
            prisma.task.findMany({
                where: {
                    assignments: { some: { userId: user.id } },
                    status: { notIn: ["DONE", "CANCELED"] },
                },
                select: { dueAt: true },
            }),
            prisma.task.findMany({
                where: {
                    assignments: { some: { userId: user.id } },
                    status: { notIn: ["DONE", "CANCELED"] },
                    dueAt: { gte: now },
                },
                select: { title: true, dueAt: true },
                orderBy: { dueAt: "asc" },
                take: 2,
            }),
        ]);

        const doneCount = await prisma.task.count({
            where: {
                assignments: { some: { userId: user.id } },
                status: "DONE",
                doneAt: { gte: weekStart, lt: weekEnd },
            },
        });
        const openCount = openTasks.length;
        const overdueCount = openTasks.filter((t) => t.dueAt && new Date(t.dueAt) < now).length;

        if (doneCount === 0 && openCount === 0) continue; // nothing to say

        const doneLine = doneCount > 0
            ? `Last week: ${doneCount} done` +
              (doneTasks.length ? ` — ${doneTasks.map((t) => `"${t.title.slice(0, 40)}"`).join(", ")}` : "") +
              (doneCount > doneTasks.length ? ` +${doneCount - doneTasks.length} more` : "")
            : "Last week: nothing marked done";

        const openLine = `Now open: ${openCount}${overdueCount > 0 ? ` (${overdueCount} overdue)` : ""}`;

        const fmtDue = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short" });
        const upcomingLine = upcoming.length > 0
            ? `Next up: ${upcoming.map((t) => `"${t.title.slice(0, 32)}" (${t.dueAt ? fmtDue(new Date(t.dueAt)) : ""})`).join(", ")}`
            : "Next up: nothing scheduled";

        notifications.push({
            userId: user.id,
            type: "weekly_summary",
            title: "Your week in review",
            body: [doneLine, openLine, upcomingLine].join("\n"),
            linkUrl: "/tasks?tab=my",
        });
    }

    if (notifications.length > 0) {
        await prisma.notification.createMany({ data: notifications });
    }

    return { created: notifications.length, skipped };
}



async function buildDigest(ownerId?: string): Promise<{
    bullets: string[];
    weekLabel: string;
    body: string;
    weekStart: Date;
    weekEnd: Date;
    counts: DigestCounts;
}> {
    if (!process.env.GLM_API_KEY) {
        throw new Error("GLM_API_KEY not configured");
    }

    const now = new Date();
    const { weekStart, weekEnd } = riyadhWeekWindow(now);

    // The GM-style summary comes from the shared executive module (same voice as
    // the "AI enhance" button on /reports). `bullets` are full prose sentences.
    const ctx = await gatherWeekContext();
    const extras = ownerId ? await gatherPromptExtras(ownerId).catch(() => undefined) : undefined;
    const bullets = await generateExecutiveSummary(ctx, extras);

    // Accurate snapshot totals (not the capped context lists used for the prompt).
    const [completedCount, inProgressCount, overdueCount, upcomingCount, activeProjectCount, kpiRiskCount] =
        await Promise.all([
            prisma.task.count({ where: { status: "DONE", doneAt: { gte: weekStart, lte: weekEnd } } }),
            prisma.task.count({ where: { status: "DOING" } }),
            prisma.task.count({ where: { status: { notIn: ["DONE", "CANCELED"] }, dueAt: { lt: now } } }),
            prisma.task.count({
                where: {
                    status: { notIn: ["DONE", "CANCELED"] },
                    dueAt: { gte: now, lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
                },
            }),
            prisma.project.count({ where: { status: { not: "Done" } } }),
            prisma.kPI.count({ where: { status: { in: ["AT_RISK", "OFF_TRACK"] } } }),
        ]);

    const weekLabel = formatWeekLabel(weekStart, weekEnd);

    const body = [
        `# Sunday Executive Digest — ${weekLabel}`,
        "",
        ...bullets,
        "",
        "---",
        "",
        `## Week snapshot`,
        `- Completed: ${completedCount}`,
        `- In progress: ${inProgressCount}`,
        `- Overdue: ${overdueCount}`,
        `- Upcoming: ${upcomingCount}`,
        `- Active projects: ${activeProjectCount}`,
        `- KPIs at risk: ${kpiRiskCount}`,
    ].join("\n");

    return {
        bullets,
        weekLabel,
        body,
        weekStart,
        weekEnd,
        counts: {
            completedCount,
            inProgressCount,
            overdueCount,
            upcomingCount,
            activeProjectCount,
            kpiRiskCount,
        },
    };
}



type DigestRunResult = {
    success: true;
    report: { id: string | null; title: string; bullets: string[]; weekLabel: string };
    mail: Record<string, unknown>;
    preview?: { counts: DigestPreview["counts"] };
};

function reportShape(preview: DigestPreview, draftId: string | null = null) {
    return {
        id: draftId,
        title: preview.title,
        bullets: preview.bullets,
        weekLabel: preview.weekLabel,
    };
}

async function buildReadOnlyPreview(actorScopes: DigestActorScopes): Promise<DigestPreview> {
    const { weekStart, weekEnd } = riyadhWeekWindow(new Date());
    return buildDigestPreview(prisma, { weekStart, weekEnd, actorScopes });
}

async function buildGeneratedPreview(ownerId: string | undefined, actorScopes: DigestActorScopes): Promise<DigestPreview> {
    const generated = await buildDigest(ownerId);
    return {
        weekStart: generated.weekStart,
        weekEnd: generated.weekEnd,
        weekLabel: generated.weekLabel,
        title: `Sunday Digest — ${generated.weekLabel}`,
        bullets: generated.bullets,
        body: generated.body,
        counts: generated.counts,
        actorScopes,
    };
}

async function saveGeneratedDraft(ownerId: string | undefined, actorScopes: DigestActorScopes) {
    const preview = await buildGeneratedPreview(ownerId, actorScopes);
    const draft = await saveDigestDraft(prisma, preview);
    return { preview, draft };
}

async function sendDraft(
    preview: DigestPreview,
    draft: Awaited<ReturnType<typeof saveDigestDraft>>,
    explicitExternalApproval: boolean,
) {
    const emailSender: DigestEmailSender = async ({ to, draft: draftToSend }) => {
        const sent = await sendSundayDigest({
            to: [to],
            bullets: preview.bullets,
            weekLabel: preview.weekLabel,
            reportId: draftToSend.id,
        });
        if (sent.skipped) return { outcome: "failed", message: sent.reason, retryable: false };
        if (!sent.accepted || !sent.providerId) {
            return { outcome: "failed", message: sent.error ?? "Email provider did not accept the digest", retryable: true };
        }
        return { outcome: "accepted", providerId: sent.providerId };
    };

    return sendApprovedDigest(
        prisma,
        {
            draftId: draft.id,
            internalDomains: configuredInternalDomains(),
            explicitExternalApproval,
        },
        emailSender,
    );
}

function mailForSend(result: Awaited<ReturnType<typeof sendApprovedDigest>>): Record<string, unknown> {
    const accepted = result.outcomes.find(({ outcome }) => outcome.outcome === "accepted");
    const providerId = accepted?.outcome.outcome === "accepted" ? accepted.outcome.providerId : null;
    if (result.sent.length > 0) {
        return {
            skipped: false,
            id: providerId,
            recipients: result.sent,
            validation: result.validation,
        };
    }

    const reason = result.validation.valid.length === 0
        ? "no valid recipients configured (SUNDAY_DIGEST_TO)"
        : "email delivery failed";
    return { skipped: true, reason, validation: result.validation };
}

function isPreviewRequest(url: URL): boolean {
    return url.searchParams.get("preview") === "true"
        || url.searchParams.get("dry-run") === "true"
        || url.searchParams.get("deliver") === "false";
}

function isDraftRequest(url: URL): boolean {
    return url.searchParams.get("draft") === "true"
        || url.searchParams.get("save-draft") === "true"
        || url.searchParams.get("action") === "draft";
}

export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const url = new URL(request.url);
        const actorScopes: DigestActorScopes = { id: "cron", role: "ADMIN", departmentIds: [] };
        if (isPreviewRequest(url)) {
            const preview = await buildReadOnlyPreview(actorScopes);
            const result: DigestRunResult = {
                success: true,
                report: reportShape(preview),
                mail: { skipped: true, reason: "delivery not requested" },
                preview: { counts: preview.counts },
            } as DigestRunResult;
            return NextResponse.json(result);
        }

        const { preview, draft } = await saveGeneratedDraft(undefined, actorScopes);
        const delivery = await sendDraft(preview, draft, url.searchParams.get("explicitExternalApproval") === "true");
        const summaries = await generatePersonalSummaries();
        return NextResponse.json({
            success: true,
            report: reportShape(preview, draft.id),
            mail: mailForSend(delivery),
            summaries,
        });
    } catch (error) {
        console.error("GET /api/cron/sunday-digest error:", error);
        return NextResponse.json({ error: (error as Error).message || "Failed" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        let actor;
        try {
            actor = await toSabahActor(session.user);
        } catch {
            return NextResponse.json({ error: "Admin only" }, { status: 403 });
        }
        if (actor.role !== "ADMIN") {
            return NextResponse.json({ error: "Admin only" }, { status: 403 });
        }
        const url = new URL(request.url);
        const actorScopes: DigestActorScopes = {
            id: actor.id,
            role: actor.role,
            departmentIds: actor.departmentIds,
        };

        if (isPreviewRequest(url)) {
            const preview = await buildReadOnlyPreview(actorScopes);
            return NextResponse.json({
                success: true,
                report: reportShape(preview),
                mail: { skipped: true, reason: "delivery not requested" },
                preview: { counts: preview.counts },
            });
        }

        const { preview, draft } = await saveGeneratedDraft(actor.id, actorScopes);
        if (isDraftRequest(url)) {
            return NextResponse.json({
                success: true,
                report: reportShape(preview, draft.id),
                mail: { skipped: true, reason: "draft saved" },
            });
        }

        const delivery = await sendDraft(preview, draft, url.searchParams.get("explicitExternalApproval") === "true");
        let summaries: { created: number; skipped: number } | undefined;
        if (url.searchParams.get("summaries") === "true") {
            summaries = await generatePersonalSummaries();
        }
        return NextResponse.json({
            success: true,
            report: reportShape(preview, draft.id),
            mail: mailForSend(delivery),
            summaries,
        });
    } catch (error) {
        console.error("POST /api/cron/sunday-digest error:", error);
        return NextResponse.json({ error: (error as Error).message || "Failed" }, { status: 500 });
    }
}
