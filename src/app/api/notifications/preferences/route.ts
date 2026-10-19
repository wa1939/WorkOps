import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DEFAULT_CATEGORIES = ["email", "task", "digest", "account_security"] as const;
const DEFAULT_TIMEZONE = "Asia/Riyadh";

const preferenceInput = z.object({
    category: z.string().trim().min(1, "Category is required").max(64, "Category is too long"),
    emailEnabled: z.boolean().optional(),
    inAppEnabled: z.boolean().optional(),
    pushEnabled: z.boolean().optional(),
    quietEnabled: z.boolean().optional(),
    quietStartMinute: z.number().int().min(0).max(1439).nullable().optional(),
    quietEndMinute: z.number().int().min(0).max(1439).nullable().optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
});

type PreferenceInput = z.infer<typeof preferenceInput>;

function actorFromSession(session: any) {
    return session?.user ? { id: session.user.id, role: session.user.role } : null;
}

function defaultPreference(userId: string, category: string) {
    return {
        userId,
        category,
        emailEnabled: true,
        inAppEnabled: true,
        pushEnabled: false,
        quietEnabled: false,
        quietStartMinute: null,
        quietEndMinute: null,
        timezone: DEFAULT_TIMEZONE,
    };
}

function invalidPreference(error: unknown) {
    if (error instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid notification preference", details: error.flatten() }, { status: 400 });
    }
    return null;
}

async function readPreferences(userId: string) {
    let preferences = await prisma.notificationPreference.findMany({
        where: { userId },
        orderBy: { category: "asc" },
    });
    const existingCategories = new Set(preferences.map((preference: { category: string }) => preference.category));
    const missing = DEFAULT_CATEGORIES
        .filter((category) => !existingCategories.has(category))
        .map((category) => defaultPreference(userId, category));

    if (missing.length > 0) {
        await prisma.notificationPreference.createMany({ data: missing, skipDuplicates: true });
        preferences = await prisma.notificationPreference.findMany({
            where: { userId },
            orderBy: { category: "asc" },
        });
    }
    return preferences;
}

export async function GET() {
    try {
        const session = await auth();
        const actor = actorFromSession(session);
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        return NextResponse.json({ preferences: await readPreferences(actor.id) });
    } catch (error) {
        console.error("GET /api/notifications/preferences error:", error);
        return NextResponse.json({ error: "Failed to fetch notification preferences" }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const session = await auth();
        const actor = actorFromSession(session);
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        let input: PreferenceInput;
        try {
            input = preferenceInput.parse(await request.json());
        } catch (error) {
            return invalidPreference(error) ?? NextResponse.json({ error: "Invalid notification preference" }, { status: 400 });
        }

        if (input.category === "account_security" && input.emailEnabled === false) {
            return NextResponse.json(
                { error: "Account security email cannot be disabled", code: "ACCOUNT_SECURITY_EMAIL_REQUIRED" },
                { status: 400 },
            );
        }

        const key = { userId_category: { userId: actor.id, category: input.category } };
        const current = await prisma.notificationPreference.findUnique({ where: key });
        const emailEnabled = input.emailEnabled ?? current?.emailEnabled ?? true;
        if (input.category === "account_security" && !emailEnabled) {
            return NextResponse.json(
                { error: "Account security email cannot be disabled", code: "ACCOUNT_SECURITY_EMAIL_REQUIRED" },
                { status: 400 },
            );
        }

        const values = {
            emailEnabled,
            inAppEnabled: input.inAppEnabled ?? current?.inAppEnabled ?? true,
            pushEnabled: input.pushEnabled ?? current?.pushEnabled ?? false,
            quietEnabled: input.quietEnabled ?? current?.quietEnabled ?? false,
            quietStartMinute: input.quietStartMinute !== undefined ? input.quietStartMinute : current?.quietStartMinute ?? null,
            quietEndMinute: input.quietEndMinute !== undefined ? input.quietEndMinute : current?.quietEndMinute ?? null,
            timezone: input.timezone ?? current?.timezone ?? DEFAULT_TIMEZONE,
        };
        const preference = await prisma.notificationPreference.upsert({
            where: key,
            update: values,
            create: { ...defaultPreference(actor.id, input.category), ...values },
        });
        return NextResponse.json(preference);
    } catch (error) {
        console.error("PUT /api/notifications/preferences error:", error);
        return NextResponse.json({ error: "Failed to save notification preference" }, { status: 500 });
    }
}
