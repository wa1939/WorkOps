import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../assert-local-database";
import {
    backfillWorkspaces,
    type WorkspaceBackfillAssignments,
    type WorkspaceBackfillManifest,
} from "./backfill";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    assertLocalDatabaseUrl(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

const ALL_ASSIGNMENTS: WorkspaceBackfillAssignments = {
    tasks: false,
    projects: false,
    kpis: false,
    notePages: false,
    caseStudies: false,
    weeklyReports: false,
    supportRequests: false,
    announcements: false,
    departments: false,
};

type Fixture = {
    workspaceId: string;
    userIds: { member: string; outsider: string };
    taskIds: string[];
    projectIds: string[];
};

async function createFixture(db: PrismaClient): Promise<Fixture> {
    const suffix = randomUUID();
    const fixture: Fixture = {
        workspaceId: `w03-workspace-${suffix}`,
        userIds: {
            member: `w03-member-${suffix}`,
            outsider: `w03-outsider-${suffix}`,
        },
        taskIds: [],
        projectIds: [],
    };

    await db.workspace.create({
        data: {
            id: fixture.workspaceId,
            slug: `w03-workspace-${suffix}`,
            name: "W03 backfill workspace",
        },
    });
    await db.user.createMany({
        data: [
            {
                id: fixture.userIds.member,
                email: `${fixture.userIds.member}@example.test`,
                name: "W03 Manifest Member",
                isActive: true,
            },
            {
                id: fixture.userIds.outsider,
                email: `${fixture.userIds.outsider}@example.test`,
                name: "W03 Unlisted User",
                isActive: true,
            },
        ],
    });

    return fixture;
}

async function cleanupFixture(db: PrismaClient, fixture: Fixture): Promise<void> {
    await db.task.deleteMany({ where: { id: { in: fixture.taskIds } } });
    await db.project.deleteMany({ where: { id: { in: fixture.projectIds } } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await db.workspace.deleteMany({ where: { id: fixture.workspaceId } });
    await db.user.deleteMany({ where: { id: { in: Object.values(fixture.userIds) } } });
}

async function withFixture(testBody: (db: PrismaClient, fixture: Fixture) => Promise<void>): Promise<void> {
    const db = new PrismaClient();
    let fixture: Fixture | undefined;
    try {
        fixture = await createFixture(db);
        await testBody(db, fixture);
    } finally {
        if (fixture) await cleanupFixture(db, fixture);
        await db.$disconnect();
    }
}

function manifest(
    fixture: Fixture,
    assignments: Partial<WorkspaceBackfillAssignments>,
    memberships: WorkspaceBackfillManifest["memberships"] = [
        { userId: fixture.userIds.member, role: "OWNER" },
    ],
): WorkspaceBackfillManifest {
    return {
        defaultWorkspaceId: fixture.workspaceId,
        memberships,
        assignments: { ...ALL_ASSIGNMENTS, ...assignments },
    };
}

describe.runIf(databaseEnabled)("workspace backfill", () => {
    it("rerun is idempotent", async () => {
        await withFixture(async (db, fixture) => {
            const taskId = `w03-idempotent-task-${randomUUID()}`;
            const projectId = `w03-idempotent-project-${randomUUID()}`;
            fixture.taskIds.push(taskId);
            fixture.projectIds.push(projectId);
            await db.task.create({
                data: { id: taskId, title: "W03 idempotent task", createdById: fixture.userIds.member },
            });
            await db.project.create({
                data: { id: projectId, name: "W03 idempotent project", ownerId: fixture.userIds.member },
            });

            const input = manifest(fixture, { tasks: true, projects: true });
            const first = await backfillWorkspaces(db, input, { apply: true });
            const firstTask = await db.task.findUniqueOrThrow({ where: { id: taskId } });
            const firstProject = await db.project.findUniqueOrThrow({ where: { id: projectId } });
            const firstMemberCount = await db.workspaceMember.count({ where: { workspaceId: fixture.workspaceId } });
            const firstTaskUpdatedAt = firstTask.updatedAt.getTime();
            const firstProjectUpdatedAt = firstProject.updatedAt.getTime();

            const second = await backfillWorkspaces(db, input, { apply: true });
            const secondTask = await db.task.findUniqueOrThrow({ where: { id: taskId } });
            const secondProject = await db.project.findUniqueOrThrow({ where: { id: projectId } });
            const secondMemberCount = await db.workspaceMember.count({ where: { workspaceId: fixture.workspaceId } });

            expect(first.success).toBe(true);
            expect(first.applied).toBe(true);
            expect(first.noOp).toBe(false);
            expect(first.tables.tasks.updated).toBeGreaterThanOrEqual(1);
            expect(first.tables.projects.updated).toBeGreaterThanOrEqual(1);
            expect(first.memberships.created).toBe(1);
            expect(firstTask.workspaceId).toBe(fixture.workspaceId);
            expect(firstProject.workspaceId).toBe(fixture.workspaceId);
            expect(second.success).toBe(true);
            expect(second.status).toBe("no-op");
            expect(second.applied).toBe(false);
            expect(second.noOp).toBe(true);
            expect(second.totalChanges).toBe(0);
            expect(second.tables.tasks.updated).toBe(0);
            expect(second.tables.projects.updated).toBe(0);
            expect(second.memberships.changes).toBe(0);
            expect(secondTask.updatedAt.getTime()).toBe(firstTaskUpdatedAt);
            expect(secondProject.updatedAt.getTime()).toBe(firstProjectUpdatedAt);
            expect(secondMemberCount).toBe(firstMemberCount);
        });
    });

    it("unmapped records fail closed", async () => {
        await withFixture(async (db, fixture) => {
            const taskId = `w03-unmapped-task-${randomUUID()}`;
            fixture.taskIds.push(taskId);
            await db.task.create({
                data: { id: taskId, title: "W03 unmapped task", createdById: fixture.userIds.member },
            });
            const input = manifest(fixture, { tasks: true });

            const result = await backfillWorkspaces(db, input, {
                apply: true,
                batchSize: 1,
                onAfterPass: async (tx) => {
                    const concurrentTaskId = `w03-concurrent-null-task-${randomUUID()}`;
                    fixture.taskIds.push(concurrentTaskId);
                    await tx.task.create({
                        data: {
                            id: concurrentTaskId,
                            title: "W03 concurrent null task",
                            createdById: fixture.userIds.member,
                        },
                    });
                },
            });

            expect(result.success).toBe(false);
            expect(result.status).toBe("failed");
            expect(result.applied).toBe(false);
            expect(result.noOp).toBe(false);
            expect(result.error).toMatch(/unmapped/i);
            expect(result.remainingUnmapped.tasks).toBeGreaterThan(0);
            expect(result.memberships.changes).toBe(0);
            expect(await db.workspaceMember.count({ where: { workspaceId: fixture.workspaceId } })).toBe(0);
            expect(await db.task.count({ where: { id: taskId, workspaceId: null } })).toBe(1);
        });
    });

    it("does not grant cross workspace membership", async () => {
        await withFixture(async (db, fixture) => {
            const taskId = `w03-outsider-task-${randomUUID()}`;
            fixture.taskIds.push(taskId);
            await db.task.create({
                data: { id: taskId, title: "W03 outsider-owned task", createdById: fixture.userIds.outsider },
            });

            const result = await backfillWorkspaces(db, manifest(fixture, { tasks: true }), { apply: true });
            const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
            const outsiderMembership = await db.workspaceMember.findUnique({
                where: {
                    workspaceId_userId: {
                        workspaceId: fixture.workspaceId,
                        userId: fixture.userIds.outsider,
                    },
                },
            });

            expect(result.success).toBe(true);
            expect(task.workspaceId).toBe(fixture.workspaceId);
            expect(outsiderMembership).toBeNull();
            expect(await db.workspaceMember.count({ where: { workspaceId: fixture.workspaceId } })).toBe(1);
        });
    });

    it("dry run writes nothing", async () => {
        await withFixture(async (db, fixture) => {
            const baselineUnmappedTaskCount = await db.task.count({ where: { workspaceId: null } });
            const taskId = `w03-dry-run-task-${randomUUID()}`;
            fixture.taskIds.push(taskId);
            await db.task.create({
                data: { id: taskId, title: "W03 dry-run task", createdById: fixture.userIds.member },
            });
            const before = await db.task.findUniqueOrThrow({ where: { id: taskId } });

            const result = await backfillWorkspaces(db, manifest(fixture, { tasks: true }), { apply: false });
            const after = await db.task.findUniqueOrThrow({ where: { id: taskId } });

            expect(result.success).toBe(true);
            expect(result.status).toBe("dry-run");
            expect(result.applied).toBe(false);
            expect(result.noOp).toBe(false);
            expect(result.tables.tasks.planned).toBe(baselineUnmappedTaskCount + 1);
            expect(result.tables.tasks.remainingUnmapped).toBe(baselineUnmappedTaskCount + 1);
            expect(result.tables.tasks.updated).toBe(0);
            expect(result.totalChanges).toBe(0);
            expect(result.memberships.created).toBe(1);
            expect(after.workspaceId).toBeNull();
            expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
            expect(await db.workspaceMember.count({ where: { workspaceId: fixture.workspaceId, userId: fixture.userIds.member } })).toBe(0);
        });
    });
});
