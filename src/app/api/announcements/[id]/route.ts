import { AnnouncementPriority } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewAnnouncement } from "@/lib/announcements/audience";

const statusSchema = z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"]);
const statusRank: Record<z.infer<typeof statusSchema>, number> = {
    DRAFT: 0,
    SCHEDULED: 1,
    PUBLISHED: 2,
    ARCHIVED: 3,
};

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

const patchSchema = z
    .object({
        isActive: z.boolean().optional(),
        status: statusSchema.optional(),
        publishAt: dateSchema,
        expiresAt: dateSchema,
        priority: z.nativeEnum(AnnouncementPriority).optional(),
        audienceJson: audienceJsonSchema,
        audience: audienceSelectorSchema.optional(),
        ctaUrl: z.string().max(2048).refine(isSameOriginRelativeUrl, "ctaUrl must be a same-origin relative URL").nullable().optional(),
        requireAcknowledgement: z.boolean().optional(),
        audienceVersion: z.number().int().min(1).optional(),
    })
    .superRefine((data, context) => {
        if (data.audienceJson !== undefined && data.audience !== undefined) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["audienceJson"], message: "use either audienceJson or audience" });
        }
        if (Object.keys(data).length === 0) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: "at least one announcement field is required" });
        }
    });

function publicAnnouncement(announcement: {
    id: string;
    title: string;
    body: string;
    variant: string;
    createdAt: Date;
    status: string;
    publishAt: Date | null;
    expiresAt: Date | null;
    priority: AnnouncementPriority;
    ctaUrl: string | null;
    requireAcknowledgement: boolean;
    audienceVersion: number;
}) {
    return {
        id: announcement.id,
        title: announcement.title,
        body: announcement.body,
        variant: announcement.variant,
        createdAt: announcement.createdAt,
        status: announcement.status,
        publishAt: announcement.publishAt,
        expiresAt: announcement.expiresAt,
        priority: announcement.priority,
        ctaUrl: announcement.ctaUrl,
        requireAcknowledgement: announcement.requireAcknowledgement,
        audienceVersion: announcement.audienceVersion,
    };
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const announcement = await prisma.announcement.findUnique({ where: { id } });
        if (!announcement || !(await canViewAnnouncement(prisma, announcement, session.user.id))) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        return NextResponse.json({ announcement: publicAnnouncement(announcement) });
    } catch (error) {
        console.error("GET /api/announcements/[id] error:", error);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

/** PATCH → admin toggles an announcement active/inactive or advances its lifecycle. */
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== "ADMIN") {
            return NextResponse.json({ error: "Admin only" }, { status: 403 });
        }
        const { id } = await params;
        const data = patchSchema.parse(await request.json());
        const current = await prisma.announcement.findUnique({ where: { id } });
        if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const nextStatus = data.status ?? (current.status as z.infer<typeof statusSchema>);
        if (!(nextStatus in statusRank) || statusRank[nextStatus] < statusRank[current.status as z.infer<typeof statusSchema>]) {
            return NextResponse.json({ error: "Announcement status cannot move backwards" }, { status: 400 });
        }
        if (current.status === "ARCHIVED" && nextStatus !== "ARCHIVED") {
            return NextResponse.json({ error: "Archived announcements are terminal" }, { status: 400 });
        }
        const effectivePublishAt = data.publishAt !== undefined ? data.publishAt : current.publishAt;
        if (nextStatus === "SCHEDULED" && !effectivePublishAt) {
            return NextResponse.json({ error: "publishAt is required for SCHEDULED announcements" }, { status: 400 });
        }

        const audienceInput = data.audienceJson !== undefined ? data.audienceJson : data.audience;
        const hasAudienceInput = data.audienceJson !== undefined || data.audience !== undefined;
        const audienceJson = hasAudienceInput ? serializeAudienceJson(audienceInput) : undefined;
        const audienceChanged = hasAudienceInput && audienceJson !== current.audienceJson;
        const updateData = {
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.publishAt !== undefined ? { publishAt: data.publishAt } : {}),
            ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
            ...(data.priority !== undefined ? { priority: data.priority } : {}),
            ...(hasAudienceInput ? { audienceJson } : {}),
            ...(data.ctaUrl !== undefined ? { ctaUrl: data.ctaUrl } : {}),
            ...(data.requireAcknowledgement !== undefined ? { requireAcknowledgement: data.requireAcknowledgement } : {}),
            ...(data.audienceVersion !== undefined || audienceChanged
                ? { audienceVersion: data.audienceVersion ?? current.audienceVersion + 1 }
                : {}),
        };

        const announcement = await prisma.announcement.update({ where: { id }, data: updateData });
        return NextResponse.json({ announcement });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error("PATCH /api/announcements/[id] error:", error);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

/** DELETE → admin removes an announcement (cascades its seen rows). */
export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== "ADMIN") {
            return NextResponse.json({ error: "Admin only" }, { status: 403 });
        }
        const { id } = await params;
        await prisma.announcement.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("DELETE /api/announcements/[id] error:", error);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
