import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewAnnouncement, markAcknowledged } from "@/lib/announcements/audience";

const seenSchema = z
    .object({
        acknowledge: z.boolean().optional(),
        // Accept the past-tense spelling as an additive client compatibility alias.
        acknowledged: z.boolean().optional(),
    })
    .strict();

/** Marks an announcement as seen for the current user (idempotent). */
export async function POST(
    request: Request,
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

        let requestBody: unknown = {};
        const rawBody = await request.text();
        if (rawBody.trim() !== "") {
            try {
                requestBody = JSON.parse(rawBody);
            } catch {
                return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
            }
        }
        const body = seenSchema.parse(requestBody);
        const acknowledgeRequested = body.acknowledge === true || body.acknowledged === true;

        await prisma.announcementSeen.upsert({
            where: { announcementId_userId: { announcementId: id, userId: session.user.id } },
            update: { audienceVersion: announcement.audienceVersion },
            create: {
                announcementId: id,
                userId: session.user.id,
                audienceVersion: announcement.audienceVersion,
            },
        });

        const acknowledged =
            announcement.requireAcknowledgement && acknowledgeRequested
                ? await markAcknowledged(prisma, id, session.user.id, announcement.audienceVersion)
                : null;

        return NextResponse.json({ success: true, acknowledged: Boolean(acknowledged) });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        console.error("POST /api/announcements/[id]/seen error:", error);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
