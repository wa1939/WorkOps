import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";
import {
    assertWritable,
    WorkspaceContextError,
    resolveWorkspaceContext,
} from "./context";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    assertLocalDatabaseUrl(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

type Fixture = {
    workspaceOneId: string;
    workspaceTwoId: string;
    userIds: {
        member: string;
        revoked: string;
        platformAdmin: string;
        workspaceMember: string;
        defaulting: string;
        archived: string;
    };
};

async function createFixture(prisma: PrismaClient): Promise<Fixture> {
    const suffix = randomUUID();
    const fixture: Fixture = {
        workspaceOneId: `w04-workspace-one-${suffix}`,
        workspaceTwoId: `w04-workspace-two-${suffix}`,
        userIds: {
            member: `w04-member-${suffix}`,
            revoked: `w04-revoked-${suffix}`,
            platformAdmin: `w04-platform-admin-${suffix}`,
            workspaceMember: `w04-workspace-member-${suffix}`,
            defaulting: `w04-defaulting-${suffix}`,
            archived: `w04-archived-${suffix}`,
        },
    };

    await prisma.workspace.createMany({
        data: [
            {
                id: fixture.workspaceOneId,
                slug: `w04-one-${suffix}`,
                name: "W04 Workspace One",
                timezone: "Asia/Riyadh",
            },
            {
                id: fixture.workspaceTwoId,
                slug: `w04-two-${suffix}`,
                name: "W04 Workspace Two",
                timezone: "UTC",
            },
        ],
    });

    await prisma.user.createMany({
        data: [
            {
                id: fixture.userIds.member,
                email: `${fixture.userIds.member}@example.test`,
                name: "W04 Member",
            },
            {
                id: fixture.userIds.revoked,
                email: `${fixture.userIds.revoked}@example.test`,
                name: "W04 Revoked",
            },
            {
                id: fixture.userIds.platformAdmin,
                email: `${fixture.userIds.platformAdmin}@example.test`,
                name: "W04 Platform Admin",
                role: "ADMIN",
            },
            {
                id: fixture.userIds.workspaceMember,
                email: `${fixture.userIds.workspaceMember}@example.test`,
                name: "W04 Workspace Member",
            },
            {
                id: fixture.userIds.defaulting,
                email: `${fixture.userIds.defaulting}@example.test`,
                name: "W04 Defaulting",
            },
            {
                id: fixture.userIds.archived,
                email: `${fixture.userIds.archived}@example.test`,
                name: "W04 Archived",
            },
        ],
    });

    await prisma.workspaceMember.createMany({
        data: [
            { workspaceId: fixture.workspaceOneId, userId: fixture.userIds.member, role: "MEMBER" },
            { workspaceId: fixture.workspaceOneId, userId: fixture.userIds.revoked, role: "MEMBER" },
            { workspaceId: fixture.workspaceTwoId, userId: fixture.userIds.workspaceMember, role: "MEMBER" },
            { workspaceId: fixture.workspaceOneId, userId: fixture.userIds.defaulting, role: "MEMBER" },
            { workspaceId: fixture.workspaceOneId, userId: fixture.userIds.archived, role: "MEMBER" },
        ],
    });

    return fixture;
}

async function captureError(action: () => Promise<unknown>): Promise<unknown> {
    try {
        await action();
    } catch (error) {
        return error;
    }
    throw new Error("Expected the action to reject");
}

async function cleanupFixture(prisma: PrismaClient, fixture: Fixture): Promise<void> {
    await prisma.workspaceMember.deleteMany({
        where: { workspaceId: { in: [fixture.workspaceOneId, fixture.workspaceTwoId] } },
    });
    await prisma.workspace.deleteMany({
        where: { id: { in: [fixture.workspaceOneId, fixture.workspaceTwoId] } },
    });
    await prisma.user.deleteMany({
        where: { id: { in: Object.values(fixture.userIds) } },
    });
}

describe.runIf(databaseEnabled)("persisted workspace authorization context", () => {
    it("rejects forged workspace id", async () => {
        const prisma = new PrismaClient();
        const fixture = await createFixture(prisma);

        try {
            const unknownWorkspaceError = await captureError(() =>
                resolveWorkspaceContext(prisma, fixture.userIds.member, `missing-${randomUUID()}`),
            );
            const nonMemberError = await captureError(() =>
                resolveWorkspaceContext(prisma, fixture.userIds.member, fixture.workspaceTwoId),
            );

            expect(unknownWorkspaceError).toBeInstanceOf(WorkspaceContextError);
            expect(nonMemberError).toBeInstanceOf(WorkspaceContextError);
            expect(unknownWorkspaceError).toMatchObject({ status: 404, code: "WORKSPACE_NOT_FOUND" });
            expect(nonMemberError).toMatchObject({ status: 404, code: "WORKSPACE_NOT_FOUND" });
            expect(nonMemberError).toMatchObject({
                status: (unknownWorkspaceError as WorkspaceContextError).status,
                code: (unknownWorkspaceError as WorkspaceContextError).code,
            });
        } finally {
            try {
                await cleanupFixture(prisma, fixture);
            } finally {
                await prisma.$disconnect();
            }
        }
    });

    it("revoked membership takes effect without relogin", async () => {
        const prisma = new PrismaClient();
        const fixture = await createFixture(prisma);

        try {
            const resolved = await resolveWorkspaceContext(
                prisma,
                fixture.userIds.revoked,
                fixture.workspaceOneId,
            );
            expect(resolved.membershipActive).toBe(true);
            expect(resolved.canWrite).toBe(true);

            await prisma.workspaceMember.update({
                where: {
                    workspaceId_userId: {
                        workspaceId: fixture.workspaceOneId,
                        userId: fixture.userIds.revoked,
                    },
                },
                data: { active: false },
            });

            const error = await captureError(() =>
                resolveWorkspaceContext(prisma, fixture.userIds.revoked, fixture.workspaceOneId),
            );
            expect(error).toMatchObject({
                status: 403,
                code: "MEMBERSHIP_INACTIVE",
            });
        } finally {
            try {
                await cleanupFixture(prisma, fixture);
            } finally {
                await prisma.$disconnect();
            }
        }
    });

    it("workspace admin is not platform admin", async () => {
        const prisma = new PrismaClient();
        const fixture = await createFixture(prisma);

        try {
            const platformAdminError = await captureError(() =>
                resolveWorkspaceContext(prisma, fixture.userIds.platformAdmin, fixture.workspaceTwoId),
            );
            expect(platformAdminError).toMatchObject({
                status: 404,
                code: "WORKSPACE_NOT_FOUND",
            });

            const workspaceMemberContext = await resolveWorkspaceContext(
                prisma,
                fixture.userIds.workspaceMember,
                fixture.workspaceTwoId,
            );
            expect(workspaceMemberContext.role).toBe("MEMBER");
            expect(workspaceMemberContext.workspaceId).toBe(fixture.workspaceTwoId);
            expect(workspaceMemberContext.canWrite).toBe(true);
        } finally {
            try {
                await cleanupFixture(prisma, fixture);
            } finally {
                await prisma.$disconnect();
            }
        }
    });

    it("defaults only when exactly one membership", async () => {
        const prisma = new PrismaClient();
        const fixture = await createFixture(prisma);

        try {
            const defaultContext = await resolveWorkspaceContext(
                prisma,
                fixture.userIds.defaulting,
                null,
            );
            expect(defaultContext.workspaceId).toBe(fixture.workspaceOneId);

            await prisma.workspaceMember.create({
                data: {
                    workspaceId: fixture.workspaceTwoId,
                    userId: fixture.userIds.defaulting,
                    role: "VIEWER",
                },
            });

            const error = await captureError(() =>
                resolveWorkspaceContext(prisma, fixture.userIds.defaulting, null),
            );
            expect(error).toMatchObject({
                status: 409,
                code: "WORKSPACE_SELECTION_REQUIRED",
            });
        } finally {
            try {
                await cleanupFixture(prisma, fixture);
            } finally {
                await prisma.$disconnect();
            }
        }
    });

    it("archived workspace is read-only", async () => {
        const prisma = new PrismaClient();
        const fixture = await createFixture(prisma);
        const archivedAt = new Date("2026-09-07T00:00:00.000Z");

        try {
            await prisma.workspace.update({
                where: { id: fixture.workspaceOneId },
                data: { archivedAt },
            });

            const context = await resolveWorkspaceContext(
                prisma,
                fixture.userIds.archived,
                fixture.workspaceOneId,
            );
            expect(context.workspace.archivedAt).toEqual(archivedAt);
            expect(context.membershipActive).toBe(true);
            expect(context.canWrite).toBe(false);

            let error: unknown;
            try {
                assertWritable(context);
            } catch (caught) {
                error = caught;
            }
            expect(error).toBeInstanceOf(WorkspaceContextError);
            expect(error).toMatchObject({
                status: 403,
                code: "WORKSPACE_ARCHIVED",
            });
        } finally {
            try {
                await cleanupFixture(prisma, fixture);
            } finally {
                await prisma.$disconnect();
            }
        }
    });
});
