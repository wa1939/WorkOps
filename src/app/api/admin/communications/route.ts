import { NextResponse } from "next/server";
import { Prisma, type DeliveryState } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseAndValidateRecipients } from "@/lib/communications/digest";
import { configuredInternalDomains } from "@/lib/communications/domains";
import { enqueueEvent } from "@/lib/communications/enqueue";
import { DELIVERY_STATES } from "@/lib/communications/contracts";
import { EMAIL_RATE_LIMIT, checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const POLICY_CATEGORIES = [
    "account_security",
    "task",
    "digest",
    "suggestion",
    "weekly_recording_gap",
    "weekly_completion_checkin",
    "stale_task_update",
] as const;

const CATEGORY_SCHEMA = z.enum(POLICY_CATEGORIES);
const CHANNEL_SCHEMA = z.enum(["email", "in_app", "push"]);
const STATE_SCHEMA = z.enum(DELIVERY_STATES);

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 50;

const CATEGORY_RECIPIENT_CONFIG_KEYS: Record<string, string> = {
    digest: "SUNDAY_DIGEST_TO",
    weekly_recording_gap: "WEEKLY_RECORDING_GAP_TO",
    weekly_completion_checkin: "WEEKLY_COMPLETION_CHECKIN_TO",
    stale_task_update: "STALE_TASK_UPDATE_TO",
};

const testSendSchema = z.object({
    action: z.literal("test-send"),
    channel: z.literal("email"),
    category: CATEGORY_SCHEMA,
});

type SafeConfigRow = {
    key: string;
    value: string;
    updatedAt: Date;
};

function redactedDestination(value: string): string {
    const at = value.lastIndexOf("@");
    if (at > 0 && at < value.length - 1) {
        return `***@${value.slice(at + 1).toLowerCase()}`;
    }
    return "***";
}

function redactedError(value: string | null): string | null {
    if (!value) return value;

    const redacted = value
        // Cover space- and delimiter-separated credentials, including Bearer abc.token.
        .replace(/(?:password|secret|token|bearer)(?:\s*[:=]\s*|\s+)[^\s,;]+/gi, "[REDACTED]")
        // Cover keyword-attached forms such as token-abc or passwordabc.
        .replace(/(?:password|secret|token|bearer)[^\s]*/gi, "[REDACTED]");
    return redacted.slice(0, 200);
}

function isSafeConfigKey(key: string): boolean {
    if (/(?:password|secret|token|api[_-]?key|credential)/i.test(key)) return false;
    return /(?:digest|reminder|notification)/i.test(key);
}

function projectConfigValue(row: SafeConfigRow): { key: string; value: string; configured: boolean; updatedAt: string } {
    if (/_TO$/i.test(row.key)) {
        const validation = parseAndValidateRecipients(row.value, {
            allowExternal: false,
            internalDomains: configuredInternalDomains(),
        });
        return {
            key: row.key,
            value: validation.valid.map(redactedDestination).join(", "),
            configured: row.value.trim().length > 0,
            updatedAt: row.updatedAt.toISOString(),
        };
    }

    return {
        key: row.key,
        value: row.value.slice(0, 200),
        configured: row.value.trim().length > 0,
        updatedAt: row.updatedAt.toISOString(),
    };
}

function configKeyForCategory(category: string): string {
    return CATEGORY_RECIPIENT_CONFIG_KEYS[category] ?? `NOTIFICATION_${category.toUpperCase()}_TO`;
}

function parseDate(value: string | null, name: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${name}`);
    return parsed;
}

function parsePageValue(value: string | null, fallback: number, name: string): number {
    if (value === null || value.trim() === "") return fallback;
    if (!/^\d+$/.test(value)) throw new Error(`Invalid ${name}`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid ${name}`);
    return parsed;
}

async function rulesView() {
    const configRows = await prisma.appConfig.findMany({
        orderBy: { key: "asc" },
        select: { key: true, value: true, updatedAt: true },
    });
    const config = (configRows as SafeConfigRow[])
        .filter((row) => isSafeConfigKey(row.key))
        .map(projectConfigValue);

    return {
        categories: [...POLICY_CATEGORIES],
        config,
        policy: {
            categories: [...POLICY_CATEGORIES],
            internalDomains: configuredInternalDomains(),
        },
    };
}

async function recipientsView(category: string | null) {
    const parsedCategory = CATEGORY_SCHEMA.safeParse(category);
    if (!parsedCategory.success) throw new Error("Invalid category");

    const configKey = configKeyForCategory(parsedCategory.data);
    const config = await prisma.appConfig.findUnique({
        where: { key: configKey },
        select: { value: true, updatedAt: true },
    });
    const validation = parseAndValidateRecipients(config?.value ?? "", {
        allowExternal: false,
        internalDomains: configuredInternalDomains(),
    });

    return {
        category: parsedCategory.data,
        configKey,
        recipients: validation.valid,
        validation,
        previewOnly: true,
        updatedAt: config?.updatedAt?.toISOString() ?? null,
    };
}

async function logView(request: Request) {
    const searchParams = new URL(request.url).searchParams;
    const channelValue = searchParams.get("channel")?.toLowerCase() ?? null;
    const stateValue = searchParams.get("state")?.toUpperCase() ?? null;
    const channel = channelValue ? CHANNEL_SCHEMA.parse(channelValue) : undefined;
    const state = stateValue ? STATE_SCHEMA.parse(stateValue) : undefined;
    const dateFrom = parseDate(searchParams.get("dateFrom"), "dateFrom");
    const dateTo = parseDate(searchParams.get("dateTo"), "dateTo");
    if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("Invalid date range");

    const page = parsePageValue(searchParams.get("page"), 1, "page");
    const requestedPageSize = parsePageValue(
        searchParams.get("pageSize") ?? searchParams.get("limit"),
        PAGE_SIZE_DEFAULT,
        "pageSize",
    );
    const pageSize = Math.min(requestedPageSize, PAGE_SIZE_MAX);
    const workspaceId = searchParams.get("workspaceId") || undefined;
    const userId = searchParams.get("userId") || undefined;
    const category = searchParams.get("category") || undefined;

    const where: Prisma.DeliveryWhereInput = {
        ...(channel ? { channel } : {}),
        ...(state ? { state: state as DeliveryState } : {}),
        ...((dateFrom || dateTo) ? { createdAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
        event: {
            ...(workspaceId ? { workspaceId } : {}),
            ...(userId ? { recipientUserId: userId } : {}),
            ...(category ? { category } : {}),
        },
    };

    const [total, deliveries] = await Promise.all([
        prisma.delivery.count({ where }),
        prisma.delivery.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
                id: true,
                event: { select: { category: true, sourceType: true } },
                channel: true,
                destinationKey: true,
                state: true,
                attempts: true,
                providerId: true,
                lastError: true,
                createdAt: true,
                updatedAt: true,
            },
        }),
    ]);

    const rows = deliveries.map((delivery) => ({
        id: delivery.id,
        event: delivery.event,
        channel: delivery.channel,
        destinationKey: redactedDestination(delivery.destinationKey),
        state: delivery.state,
        attempts: delivery.attempts,
        providerId: delivery.providerId,
        lastError: redactedError(delivery.lastError),
        createdAt: delivery.createdAt.toISOString(),
        updatedAt: delivery.updatedAt.toISOString(),
    }));

    return {
        rows,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
    };
}

export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    try {
        const view = new URL(request.url).searchParams.get("view") ?? "rules";
        if (view === "rules") return NextResponse.json(await rulesView());
        if (view === "log") return NextResponse.json(await logView(request));
        if (view === "recipients") return NextResponse.json(await recipientsView(new URL(request.url).searchParams.get("category")));
        return NextResponse.json({ error: "Invalid communications view" }, { status: 400 });
    } catch (error) {
        if (error instanceof z.ZodError || (error instanceof Error && error.message.startsWith("Invalid "))) {
            return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid communications request" }, { status: 400 });
        }
        console.error("GET /api/admin/communications error:", error);
        return NextResponse.json({ error: "Failed to load communications" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    try {
        const rate = await checkRateLimit(
            `email:${session.user.id}`,
            EMAIL_RATE_LIMIT.limit,
            EMAIL_RATE_LIMIT.windowSec,
        );
        if (!rate.allowed) {
            const response = NextResponse.json(
                { error: "Too many email requests. Please try again later." },
                { status: 429 },
            );
            response.headers.set("Retry-After", String(rate.retryAfterSec));
            return response;
        }

        const input = testSendSchema.parse(await request.json());
        const adminEmail = session.user.email;
        if (!adminEmail) return NextResponse.json({ error: "Admin email is unavailable" }, { status: 400 });

        const timestampBucket = Math.floor(Date.now() / 60_000);
        const dedupeKey = `test-send:${session.user.id}:${timestampBucket}`;
        const sourceId = `test-send:${session.user.id}:${timestampBucket}`;
        const sessionWithWorkspace = session.user as typeof session.user & { workspaceId?: string };

        await enqueueEvent(prisma, {
            workspaceId: sessionWithWorkspace.workspaceId ?? "default",
            sourceType: "admin_test_send",
            sourceId,
            sourceVersion: String(timestampBucket),
            category: input.category,
            recipientUserId: session.user.id,
            dedupeKey,
            deliveries: [{ channel: input.channel, destinationKey: adminEmail }],
        });

        const queuedEvent = await prisma.notificationEvent.findUnique({
            where: { dedupeKey },
            select: {
                id: true,
                deliveries: {
                    where: { channel: input.channel, destinationKey: adminEmail },
                    select: { id: true },
                    take: 1,
                },
            },
        });
        const queuedDelivery = queuedEvent?.deliveries[0];
        if (!queuedEvent || !queuedDelivery) {
            return NextResponse.json({ error: "Test notification was not queued" }, { status: 500 });
        }

        return NextResponse.json({ id: queuedDelivery.id, deliveryId: queuedDelivery.id, eventId: queuedEvent.id, queued: true });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Invalid test-send request" }, { status: 400 });
        }
        console.error("POST /api/admin/communications error:", error);
        return NextResponse.json({ error: "Failed to queue test notification" }, { status: 500 });
    }
}
