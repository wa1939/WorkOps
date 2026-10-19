import type { Announcement } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewAnnouncement } from "@/lib/announcements/audience";

function publicAnnouncement(announcement: Announcement) {
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

/**
 * Returns the most recent active announcement the current user has NOT yet
 * dismissed, or { announcement: null }. Drives the one-time welcome popup.
 */
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ announcement: null });
        }

        const now = new Date();
        const announcements = await prisma.announcement.findMany({
            where: {
                isActive: true,
                status: "PUBLISHED",
                AND: [
                    { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
                    { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
                ],
                seenBy: { none: { userId: session.user.id } },
            },
            orderBy: { createdAt: "desc" },
        });

        for (const announcement of announcements) {
            if (await canViewAnnouncement(prisma, announcement, session.user.id, now)) {
                return NextResponse.json({ announcement: publicAnnouncement(announcement) });
            }
        }

        return NextResponse.json({ announcement: null });
    } catch (error) {
        console.error("GET /api/announcements/active error:", error);
        return NextResponse.json({ announcement: null });
    }
}
