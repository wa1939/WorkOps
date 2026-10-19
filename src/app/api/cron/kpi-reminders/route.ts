import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createBellNotification, enqueueWithDomainWork } from "@/lib/communications/enqueue";
import {
    eventWorkspaceId,
    notificationDb,
    userDispatchOverrides,
} from "@/lib/communications/producer-helpers";

export const dynamic = "force-dynamic";

// Quarter end dates (1 week before actual quarter end)
const QUARTER_REMINDER_DATES = {
    Q1: { month: 2, day: 24 }, // March 24 (1 week before March 31)
    Q2: { month: 5, day: 24 }, // June 24 (1 week before June 30)
    Q3: { month: 8, day: 24 }, // September 24 (1 week before September 30)
    Q4: { month: 11, day: 24 }, // December 24 (1 week before December 31)
};

function getCurrentQuarter(): string {
    const now = new Date();
    const month = now.getMonth(); // 0-11

    if (month < 3) return "Q1";
    if (month < 6) return "Q2";
    if (month < 9) return "Q3";
    return "Q4";
}

function getNextQuarter(current: string): string {
    const quarters = ["Q1", "Q2", "Q3", "Q4"];
    const currentIndex = quarters.indexOf(current);
    return quarters[(currentIndex + 1) % 4];
}

function shouldSendReminder(): boolean {
    const now = new Date();
    const currentMonth = now.getMonth(); // 0-11
    const currentDay = now.getDate();

    // Check if today matches any quarter reminder date
    for (const date of Object.values(QUARTER_REMINDER_DATES)) {
        if (currentMonth === date.month && currentDay === date.day) {
            return true;
        }
    }

    return false;
}

type WorkspaceScoped = { workspaceId?: string | null };

export async function GET(request: Request) {
    try {
        // Verify cron secret (mandatory)
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Check if we should send reminders today
        if (!shouldSendReminder()) {
            return NextResponse.json({
                message: "Not a reminder date",
                sent: 0,
            });
        }

        const now = new Date();
        const currentQuarter = getCurrentQuarter();
        const nextQuarter = getNextQuarter(currentQuarter);
        const year = now.getFullYear();

        // Find KPIs that need updates for the ending quarter
        const kpis = await prisma.kPI.findMany({
            where: {
                OR: [
                    { trackingPeriod: currentQuarter },
                    { trackingPeriod: "ANNUAL" }, // Annual KPIs get reminders every quarter
                ],
            },
            include: {
                owner: true,
                updates: {
                    where: { quarter: currentQuarter },
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
        });

        // Filter KPIs that haven't been updated for current quarter
        const kpisNeedingUpdate = kpis.filter((kpi) => kpi.updates.length === 0);

        let sentCount = 0;
        for (const kpi of kpisNeedingUpdate) {
            if (!kpi.ownerId || !kpi.owner) continue;

            const { notification, ...event } = {
                workspaceId: eventWorkspaceId((kpi as typeof kpi & WorkspaceScoped).workspaceId),
                sourceType: "kpi-reminder",
                sourceId: kpi.id,
                sourceVersion: `${year}:${currentQuarter}`,
                category: "kpi" as const,
                recipientUserId: kpi.ownerId,
                dedupeKey: `kpi-reminder:${kpi.id}:${year}:${currentQuarter}`,
                ...userDispatchOverrides(kpi.owner, now),
                deliveries: [{ channel: "in_app" as const, destinationKey: kpi.ownerId }],
                notification: {
                    userId: kpi.ownerId,
                    type: "kpi_quarter_reminder",
                    title: `${currentQuarter} Ending – Update KPI`,
                    body: `Quarter ${currentQuarter} ends in 1 week. Please update "${kpi.name}" before the quarter closes.`,
                    linkUrl: `/kpis/${kpi.id}`,
                },
            };
            const result = await enqueueWithDomainWork(
                notificationDb(prisma),
                (tx) => createBellNotification(tx, notification),
                event,
            );
            if (result.created) sentCount++;
        }

        return NextResponse.json({
            message: `Sent ${sentCount} reminders for ${currentQuarter}`,
            quarter: currentQuarter,
            nextQuarter,
            sent: sentCount,
        });
    } catch (error) {
        console.error("GET /api/cron/kpi-reminders error:", error);
        return NextResponse.json(
            { error: "Failed to send KPI reminders" },
            { status: 500 },
        );
    }
}
