import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";
import { auth } from "@/lib/auth";
import { prisma as routeDb } from "@/lib/prisma";
import { GET as getActiveAnnouncements } from "../../app/api/announcements/active/route";
import { GET as getAnnouncement } from "../../app/api/announcements/[id]/route";
import { POST as markAnnouncementSeen } from "../../app/api/announcements/[id]/seen/route";
import { markAcknowledged, resolveAnnouncementAudience } from "./audience";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Announcement audience tests require a database name ending with _test");
    }
    process.env.DATABASE_URL = databaseUrl;
}

const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();
const authMock = vi.mocked(auth);

type UserFixture = {
    id: string;
    email: string;
};

async function createUser(label: string, createdAt?: Date): Promise<UserFixture> {
    const id = `a01-${label}-${randomUUID()}`;
    const email = `${id}@example.test`;
    await db.user.create({
        data: {
            id,
            email,
            name: label,
            createdAt,
        },
    });
    return { id, email };
}

async function cleanupFixture(input: {
    announcementIds?: string[];
    userIds?: string[];
    departmentIds?: string[];
}): Promise<void> {
    if (input.announcementIds?.length) {
        await db.announcementSeen.deleteMany({ where: { announcementId: { in: input.announcementIds } } });
        await db.announcement.deleteMany({ where: { id: { in: input.announcementIds } } });
    }
    if (input.userIds?.length) {
        await db.userDepartment.deleteMany({ where: { userId: { in: input.userIds } } });
        await db.user.deleteMany({ where: { id: { in: input.userIds } } });
    }
    if (input.departmentIds?.length) {
        await db.userDepartment.deleteMany({ where: { departmentId: { in: input.departmentIds } } });
        await db.department.deleteMany({ where: { id: { in: input.departmentIds } } });
    }
}

function setSession(userId: string, role: "ADMIN" | "MANAGER" | "MEMBER" | "VIEWER" = "MEMBER"): void {
    authMock.mockResolvedValue({ user: { id: userId, role } } as never);
}

function routeParams(id: string): { params: Promise<{ id: string }> } {
    return { params: Promise.resolve({ id }) };
}

describe.runIf(databaseEnabled)("announcement audience authorization", () => {
    beforeAll(() => {
        assertLocalDatabaseUrl(process.env.DATABASE_URL ?? "");
    });

    afterAll(async () => {
        await db.$disconnect();
        if (routeDb !== db) await routeDb.$disconnect();
    });

    it("outside audience cannot fetch by id", async () => {
        const department = await db.department.create({ data: { name: `A01 audience ${randomUUID()}` } });
        const member = await createUser("member", new Date(Date.now() - 120_000));
        const outside = await createUser("outside", new Date(Date.now() - 120_000));
        await db.userDepartment.create({ data: { userId: member.id, departmentId: department.id } });
        const announcement = await db.announcement.create({
            data: {
                title: "Scoped announcement",
                body: "Only one department",
                status: "PUBLISHED",
                publishAt: new Date(Date.now() - 60_000),
                audienceJson: JSON.stringify({ departments: [department.id], includeFutureMembers: false }),
            },
        });

        try {
            setSession(outside.id);
            const outsideResponse = await getAnnouncement(new Request("https://example.test"), routeParams(announcement.id));
            expect(outsideResponse.status).toBe(404);

            setSession(member.id);
            const memberResponse = await getAnnouncement(new Request("https://example.test"), routeParams(announcement.id));
            expect(memberResponse.status).toBe(200);
            expect(await memberResponse.json()).toMatchObject({ announcement: { id: announcement.id } });
        } finally {
            await cleanupFixture({
                announcementIds: [announcement.id],
                userIds: [member.id, outside.id],
                departmentIds: [department.id],
            });
        }
    });

    it("expired hidden", async () => {
        const user = await createUser("expired-viewer");
        const announcement = await db.announcement.create({
            data: {
                title: "Expired announcement",
                body: "No longer available",
                status: "PUBLISHED",
                publishAt: new Date(Date.now() - 120_000),
                expiresAt: new Date(Date.now() - 60_000),
            },
        });

        try {
            setSession(user.id);
            const activeResponse = await getActiveAnnouncements();
            expect(activeResponse.status).toBe(200);
            expect(await activeResponse.json()).toEqual({ announcement: null });

            const byIdResponse = await getAnnouncement(new Request("https://example.test"), routeParams(announcement.id));
            expect(byIdResponse.status).toBe(404);
        } finally {
            await cleanupFixture({ announcementIds: [announcement.id], userIds: [user.id] });
        }
    });

    it("view is not acknowledgement", async () => {
        const user = await createUser("ack-viewer");
        const announcement = await db.announcement.create({
            data: {
                title: "Acknowledgement announcement",
                body: "Please acknowledge",
                status: "PUBLISHED",
                publishAt: new Date(Date.now() - 60_000),
                requireAcknowledgement: true,
            },
        });
        const absentUser = await createUser("ack-absent");

        try {
            await db.announcementSeen.create({
                data: {
                    announcementId: announcement.id,
                    userId: user.id,
                    audienceVersion: announcement.audienceVersion,
                },
            });
            setSession(user.id);

            await markAnnouncementSeen(
                new Request("https://example.test", { method: "POST", body: JSON.stringify({}) }),
                routeParams(announcement.id),
            );
            const afterView = await db.announcementSeen.findUnique({
                where: { announcementId_userId: { announcementId: announcement.id, userId: user.id } },
            });
            expect(afterView?.acknowledgedAt).toBeNull();

            const acknowledged = await markAcknowledged(
                db,
                announcement.id,
                user.id,
                announcement.audienceVersion,
            );
            expect(acknowledged?.acknowledgedAt).toBeInstanceOf(Date);

            const missing = await markAcknowledged(
                db,
                announcement.id,
                absentUser.id,
                announcement.audienceVersion,
            );
            expect(missing).toBeNull();
            expect(
                await db.announcementSeen.count({ where: { announcementId: announcement.id, userId: absentUser.id } }),
            ).toBe(0);
        } finally {
            await cleanupFixture({
                announcementIds: [announcement.id],
                userIds: [user.id, absentUser.id],
            });
        }
    });

    it("future member included only when includeFutureMembers", async () => {
        const department = await db.department.create({ data: { name: `A01 future ${randomUUID()}` } });
        const initialMember = await createUser("initial", new Date("2026-08-01T00:00:00.000Z"));
        await db.userDepartment.create({ data: { userId: initialMember.id, departmentId: department.id } });
        const announcement = await db.announcement.create({
            data: {
                title: "Future membership",
                body: "Audience expands only when requested",
                status: "PUBLISHED",
                publishAt: new Date("2026-09-01T00:00:00.000Z"),
                audienceJson: JSON.stringify({ departments: [department.id], includeFutureMembers: false }),
            },
        });
        const futureMember = await createUser("future", new Date("2026-09-02T00:00:00.000Z"));

        try {
            await db.userDepartment.create({ data: { userId: futureMember.id, departmentId: department.id } });

            const frozenAudience = await resolveAnnouncementAudience(db, announcement);
            expect(frozenAudience.audienceVersion).toBe(announcement.audienceVersion);
            expect(frozenAudience.includeFutureMembers).toBe(false);
            expect(frozenAudience.userIds).toContain(initialMember.id);
            expect(frozenAudience.userIds).not.toContain(futureMember.id);

            const expandedAnnouncement = await db.announcement.update({
                where: { id: announcement.id },
                data: {
                    audienceJson: JSON.stringify({ departments: [department.id], includeFutureMembers: true }),
                    audienceVersion: { increment: 1 },
                },
            });
            const expandedAudience = await resolveAnnouncementAudience(db, expandedAnnouncement);
            expect(expandedAudience.audienceVersion).toBe(announcement.audienceVersion + 1);
            expect(expandedAudience.includeFutureMembers).toBe(true);
            expect(expandedAudience.userIds).toContain(futureMember.id);
        } finally {
            await cleanupFixture({
                announcementIds: [announcement.id],
                userIds: [initialMember.id, futureMember.id],
                departmentIds: [department.id],
            });
        }
    });
});
