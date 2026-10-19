import type { Announcement, Prisma, PrismaClient } from "@prisma/client";

export type AnnouncementDb = {
    user: Pick<PrismaClient["user"], "findMany" | "findUnique">;
    announcementSeen: Pick<PrismaClient["announcementSeen"], "findUnique" | "updateMany">;
};

export type AnnouncementAudienceRecord = Pick<
    Announcement,
    | "audienceJson"
    | "audienceVersion"
    | "createdAt"
    | "createdById"
    | "expiresAt"
    | "isActive"
    | "publishAt"
    | "status"
>;

export type ResolvedAnnouncementAudience = {
    userIds: string[];
    audienceVersion: number;
    includeFutureMembers: boolean;
};

type AudienceSelector = {
    departments: string[];
    includeFutureMembers: boolean;
};

const DEFAULT_AUDIENCE: AudienceSelector = {
    departments: [],
    includeFutureMembers: false,
};

function parseAudienceSelector(audienceJson: string | null): AudienceSelector | null {
    if (audienceJson === null || audienceJson.trim() === "") return DEFAULT_AUDIENCE;

    let parsed: unknown;
    try {
        parsed = JSON.parse(audienceJson);
    } catch {
        return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    const departments = value.departments ?? [];
    const includeFutureMembers = value.includeFutureMembers ?? false;

    if (
        !Array.isArray(departments) ||
        !departments.every((department): department is string => typeof department === "string" && department.length > 0) ||
        typeof includeFutureMembers !== "boolean"
    ) {
        return null;
    }

    return {
        departments: Array.from(new Set(departments)),
        includeFutureMembers,
    };
}

export async function resolveAnnouncementAudience(
    db: AnnouncementDb,
    announcement: AnnouncementAudienceRecord,
): Promise<ResolvedAnnouncementAudience> {
    const selector = parseAudienceSelector(announcement.audienceJson);
    if (!selector) {
        return {
            userIds: [],
            audienceVersion: announcement.audienceVersion,
            includeFutureMembers: false,
        };
    }

    const where: Prisma.UserWhereInput = { isActive: true };
    if (selector.departments.length > 0) {
        where.departments = {
            some: { departmentId: { in: selector.departments } },
        };

        // UserDepartment predates this lifecycle field and has no membership
        // timestamp. The user's creation time is the available publish-time
        // boundary for a frozen selector; the opt-in flag re-expands it.
        if (!selector.includeFutureMembers) {
            where.createdAt = { lte: announcement.publishAt ?? announcement.createdAt };
        }
    }

    const users = await db.user.findMany({
        where,
        orderBy: { id: "asc" },
        select: { id: true },
    });

    return {
        userIds: users.map((user) => user.id),
        audienceVersion: announcement.audienceVersion,
        includeFutureMembers: selector.includeFutureMembers,
    };
}

export async function canViewAnnouncement(
    db: AnnouncementDb,
    announcement: AnnouncementAudienceRecord,
    userId: string,
    now = new Date(),
): Promise<boolean> {
    if (
        announcement.isActive === false ||
        announcement.status !== "PUBLISHED" ||
        (announcement.publishAt !== null && announcement.publishAt > now) ||
        (announcement.expiresAt !== null && announcement.expiresAt <= now)
    ) {
        return false;
    }

    const user = await db.user.findUnique({
        where: { id: userId },
        select: { role: true, isActive: true },
    });
    if (!user) return false;

    // Authors and admins can inspect a published announcement even when its
    // department selector does not include them.
    if (announcement.createdById === userId || user.role === "ADMIN") return true;
    if (!user.isActive) return false;

    const audience = await resolveAnnouncementAudience(db, announcement);
    return audience.userIds.includes(userId);
}

export async function markAcknowledged(
    db: AnnouncementDb,
    announcementId: string,
    userId: string,
    audienceVersion: number,
): Promise<Prisma.AnnouncementSeenGetPayload<{ select: { id: true; announcementId: true; userId: true; seenAt: true; acknowledgedAt: true; audienceVersion: true } }> | null> {
    const where = { announcementId_userId: { announcementId, userId } };
    const existing = await db.announcementSeen.findUnique({
        where,
        select: {
            id: true,
            announcementId: true,
            userId: true,
            seenAt: true,
            acknowledgedAt: true,
            audienceVersion: true,
        },
    });
    if (!existing) return null;

    const result = await db.announcementSeen.updateMany({
        where: { id: existing.id },
        data: {
            acknowledgedAt: existing.acknowledgedAt ?? new Date(),
            audienceVersion,
        },
    });
    if (result.count === 0) return null;

    return db.announcementSeen.findUnique({
        where,
        select: {
            id: true,
            announcementId: true,
            userId: true,
            seenAt: true,
            acknowledgedAt: true,
            audienceVersion: true,
        },
    });
}
