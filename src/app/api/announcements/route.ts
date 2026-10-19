import { AnnouncementPriority, type Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const statusSchema = z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"]);

const audienceSelectorSchema = z
    .object({
        departments: z.array(z.string().min(1).max(200)).default([]),
        includeFutureMembers: z.boolean().default(false),
    })
    .strict();

const audienceJsonStringSchema = z
    .string()
    .max(10_000)
    .superRefine((value, context) => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(value);
        } catch {
            context.addIssue({ code: z.ZodIssueCode.custom, message: "audienceJson must contain valid JSON" });
            return;
        }
        if (!audienceSelectorSchema.safeParse(parsed).success) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "audienceJson must contain departments and includeFutureMembers",
            });
        }
    });

const audienceJsonSchema = z.union([audienceJsonStringSchema, audienceSelectorSchema]).nullable().optional();
const dateSchema = z.coerce.date().nullable().optional();

function isSameOriginRelativeUrl(value: string): boolean {
    if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) {
        return false;
    }
    try {
        const parsed = new URL(value, "https://departmenthub.invalid");
        return parsed.origin === "https://departmenthub.invalid";
    } catch {
        return false;
    }
}

function serializeAudienceJson(value: unknown): string | null {
    if (value === null) return null;
    if (typeof value === "string") {
        return JSON.stringify(audienceSelectorSchema.parse(JSON.parse(value)));
    }
    return JSON.stringify(audienceSelectorSchema.parse(value));
}

const createSchema = z
    .object({
        title: z.string().min(1).max(120),
        body: z.string().min(1).max(4000),
        variant: z.enum(["celebrate", "info", "warning"]).default("celebrate"),
        status: statusSchema.optional(),
        publishAt: dateSchema,
        expiresAt: dateSchema,
        priority: z.nativeEnum(AnnouncementPriority).default(AnnouncementPriority.NORMAL),
        audienceJson: audienceJsonSchema,
        // Accepting the object alias keeps authoring clients from having to
        // stringify selector data themselves; audienceJson remains canonical.
        audience: audienceSelectorSchema.optional(),
        ctaUrl: z.string().max(2048).refine(isSameOriginRelativeUrl, "ctaUrl must be a same-origin relative URL").nullable().optional(),
        requireAcknowledgement: z.boolean().default(false),
        audienceVersion: z.number().int().min(1).optional(),
        workspaceId: z.string().min(1).max(200).nullable().optional(),
    })
    .superRefine((data, context) => {
        if (data.status === "SCHEDULED" && !data.publishAt) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["publishAt"], message: "publishAt is required for SCHEDULED announcements" });
        }
        if (data.audienceJson !== undefined && data.audience !== undefined) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["audienceJson"], message: "use either audienceJson or audience" });
        }
    });

type AudienceSelector = {
    departments: string[];
    includeFutureMembers: boolean;
};

const EMPTY_AUDIENCE: AudienceSelector = {
    departments: [],
    includeFutureMembers: false,
};

function parseAudienceSelector(value: unknown): AudienceSelector {
    if (typeof value !== "string" || value.trim() === "") return EMPTY_AUDIENCE;
    try {
        const parsed = JSON.parse(value) as Partial<AudienceSelector>;
        return {
            departments: Array.isArray(parsed.departments)
                ? Array.from(new Set(parsed.departments.filter((id): id is string => typeof id === "string" && id.length > 0)))
                : [],
            includeFutureMembers: parsed.includeFutureMembers === true,
        };
    } catch {
        return EMPTY_AUDIENCE;
    }
}

function selectorFromQuery(searchParams: URLSearchParams): AudienceSelector {
    return {
        departments: Array.from(new Set((searchParams.get("departments") ?? "").split(",").map((id) => id.trim()).filter(Boolean))),
        includeFutureMembers: searchParams.get("includeFutureMembers") === "true",
    };
}

function recordValue(record: unknown, key: string): unknown {
    return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
}

function audienceVersionOf(announcement: unknown): number {
    const value = recordValue(announcement, "audienceVersion");
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

function publishBoundaryOf(announcement: unknown): Date {
    const publishAt = recordValue(announcement, "publishAt");
    if (publishAt instanceof Date) return publishAt;
    const createdAt = recordValue(announcement, "createdAt");
    return createdAt instanceof Date ? createdAt : new Date();
}

async function countEligibleAudience(selector: AudienceSelector, announcement: unknown): Promise<number> {
    const where: Prisma.UserWhereInput = { isActive: true };
    if (selector.departments.length > 0) {
        where.departments = { some: { departmentId: { in: selector.departments } } };
        if (!selector.includeFutureMembers) {
            where.createdAt = { lte: publishBoundaryOf(announcement) };
        }
    }
    return prisma.user.count({ where });
}

async function scopedSeenCount(announcementId: string, audienceVersion: number): Promise<number> {
    try {
        return await prisma.announcementSeen.count({
            where: { announcementId, audienceVersion } as never,
        });
    } catch {
        return prisma.announcementSeen.count({ where: { announcementId } });
    }
}

async function scopedAcknowledgedCount(announcementId: string, audienceVersion: number): Promise<number> {
    try {
        return await prisma.announcementSeen.count({
            where: { announcementId, audienceVersion, acknowledgedAt: { not: null } } as never,
        });
    } catch {
        return 0;
    }
}

/** GET → admin list, audience preview, and scoped seen/acknowledgement counts. */
export async function GET(request: Request) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (session.user.role !== "ADMIN") {
            return NextResponse.json({ error: "Admin only" }, { status: 403 });
        }

        const searchParams = new URL(request.url).searchParams;
        if (searchParams.get("preview") === "1") {
            const selector = selectorFromQuery(searchParams);
            const audienceCount = await countEligibleAudience(selector, { createdAt: new Date() });
            return NextResponse.json({
                audienceCount,
                eligibleCount: audienceCount,
                audienceVersion: 1,
            });
        }

        const [announcements, activeUsers] = await Promise.all([
            prisma.announcement.findMany({
                orderBy: { createdAt: "desc" },
                include: {
                    createdBy: { select: { name: true } },
                    _count: { select: { seenBy: true } },
                },
            }),
            prisma.user.count({ where: { isActive: true } }),
        ]);

        const scopedAnnouncements = await Promise.all(announcements.map(async (announcement) => {
            const audienceVersion = audienceVersionOf(announcement);
            const selector = parseAudienceSelector(recordValue(announcement, "audienceJson"));
            const [eligibleCount, seenCount, acknowledgedCount] = await Promise.all([
                countEligibleAudience(selector, announcement),
                scopedSeenCount(announcement.id, audienceVersion),
                scopedAcknowledgedCount(announcement.id, audienceVersion),
            ]);
            return {
                ...announcement,
                audienceVersion,
                eligibleCount,
                seenCount,
                acknowledgedCount,
                scopedDenominator: eligibleCount,
            };
        }));

        return NextResponse.json({ announcements: scopedAnnouncements, activeUsers });
    } catch (error) {
        console.error("GET /api/announcements error:", error);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

/** POST → admin creates (and, for the legacy payload, broadcasts) an announcement. */
export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (session.user.role !== "ADMIN") {
            return NextResponse.json({ error: "Admin only" }, { status: 403 });
        }

        const data = createSchema.parse(await request.json());
        const status = data.status ?? "PUBLISHED";
        const audienceInput = data.audienceJson !== undefined ? data.audienceJson : data.audience;
        const publishAt = data.publishAt !== undefined ? data.publishAt : data.status === undefined ? new Date() : undefined;

        const announcement = await prisma.announcement.create({
            data: {
                title: data.title,
                body: data.body,
                variant: data.variant,
                status,
                publishAt,
                expiresAt: data.expiresAt,
                priority: data.priority,
                audienceJson: audienceInput === undefined ? undefined : serializeAudienceJson(audienceInput),
                ctaUrl: data.ctaUrl,
                requireAcknowledgement: data.requireAcknowledgement,
                audienceVersion: data.audienceVersion ?? 1,
                workspaceId: data.workspaceId,
                createdById: session.user.id,
            },
        });

        return NextResponse.json({ announcement });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error("POST /api/announcements error:", error);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
