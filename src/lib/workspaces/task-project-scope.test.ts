import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";
import {
    countTasksForActor,
    getTaskForActor,
    listTasksForActor,
    moveTaskToWorkspace,
    updateTask,
} from "../tasks/commands";
import { listProjectsForActor } from "../projects/commands";

type Fixture = {
    workspaceAId: string;
    workspaceBId: string;
    userIds: {
        actor: string;
        actorOnlyB: string;
        assigneeA: string;
        assigneeB: string;
    };
    taskIds: string[];
    projectIds: string[];
};

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    assertLocalDatabaseUrl(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

async function createFixture(prisma: PrismaClient): Promise<Fixture> {
    const suffix = randomUUID();
    const fixture: Fixture = {
        workspaceAId: `w05-workspace-a-${suffix}`,
        workspaceBId: `w05-workspace-b-${suffix}`,
        userIds: {
            actor: `w05-actor-${suffix}`,
            actorOnlyB: `w05-actor-only-b-${suffix}`,
            assigneeA: `w05-assignee-a-${suffix}`,
            assigneeB: `w05-assignee-b-${suffix}`,
        },
        taskIds: [],
        projectIds: [],
    };

    await prisma.workspace.createMany({
        data: [
            {
                id: fixture.workspaceAId,
                slug: `w05-a-${suffix}`,
                name: "W05 Workspace A",
                timezone: "Asia/Riyadh",
            },
            {
                id: fixture.workspaceBId,
                slug: `w05-b-${suffix}`,
                name: "W05 Workspace B",
                timezone: "UTC",
            },
        ],
    });

    await prisma.user.createMany({
        data: [
            {
                id: fixture.userIds.actor,
                email: `${fixture.userIds.actor}@example.test`,
                name: "W05 Actor",
            },
            {
                id: fixture.userIds.actorOnlyB,
                email: `${fixture.userIds.actorOnlyB}@example.test`,
                name: "W05 B-only Actor",
            },
            {
                id: fixture.userIds.assigneeA,
                email: `${fixture.userIds.assigneeA}@example.test`,
                name: "W05 A Assignee",
            },
            {
                id: fixture.userIds.assigneeB,
                email: `${fixture.userIds.assigneeB}@example.test`,
                name: "W05 B Assignee",
            },
        ],
    });

    await prisma.workspaceMember.createMany({
        data: [
            { workspaceId: fixture.workspaceAId, userId: fixture.userIds.actor, role: "MEMBER" },
            { workspaceId: fixture.workspaceBId, userId: fixture.userIds.actor, role: "MEMBER" },
            { workspaceId: fixture.workspaceBId, userId: fixture.userIds.actorOnlyB, role: "MEMBER" },
            { workspaceId: fixture.workspaceAId, userId: fixture.userIds.assigneeA, role: "MEMBER" },
            { workspaceId: fixture.workspaceBId, userId: fixture.userIds.assigneeB, role: "MEMBER" },
        ],
    });

    return fixture;
}

async function cleanupFixture(prisma: PrismaClient, fixture: Fixture): Promise<void> {
    await prisma.task.deleteMany({ where: { id: { in: fixture.taskIds } } });
    await prisma.project.deleteMany({ where: { id: { in: fixture.projectIds } } });
    await prisma.workspaceMember.deleteMany({
        where: { workspaceId: { in: [fixture.workspaceAId, fixture.workspaceBId] } },
    });
    await prisma.workspace.deleteMany({
        where: { id: { in: [fixture.workspaceAId, fixture.workspaceBId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(fixture.userIds) } } });
}

describe.runIf(databaseEnabled)("workspace-scoped task and project commands", () => {
    it("cannot move a task by changing workspaceId", async () => {
        const prisma = new PrismaClient();
        const fixture = await createFixture(prisma);
        const actor = { id: fixture.userIds.actor, role: "MEMBER" as const, departmentIds: [] };
        const bOnlyActor = { id: fixture.userIds.actorOnlyB, role: "MEMBER" as const };

        try {
            const task = await prisma.task.create({
                data: {
                    id: `w05-move-${randomUUID()}`,
                    title: "W05 guarded move",
                    workspaceId: fixture.workspaceAId,
                    createdById: fixture.userIds.actor,
                    isPrivate: false,
                },
            });
            fixture.taskIds.push(task.id);
            const taskWithoutSourceMembership = await prisma.task.create({
                data: {
                    id: `w05-move-no-source-${randomUUID()}`,
                    title: "W05 missing source membership",
                    workspaceId: fixture.workspaceAId,
                    createdById: fixture.userIds.actor,
                    isPrivate: false,
                },
            });
            fixture.taskIds.push(taskWithoutSourceMembership.id);

            await expect(
                updateTask(
                    task.id,
                    { workspaceId: fixture.workspaceBId } as any,
                    actor,
                    prisma,
                ),
            ).rejects.toThrow("cannot move a task by changing workspaceId");

            await expect(
                moveTaskToWorkspace(prisma, taskWithoutSourceMembership.id, fixture.workspaceBId, bOnlyActor),
            ).rejects.toThrow();

            await moveTaskToWorkspace(prisma, task.id, fixture.workspaceBId, actor);
            const moved = await getTaskForActor(task.id, actor, prisma, fixture.workspaceBId);
            expect(moved.workspaceId).toBe(fixture.workspaceBId);
        } finally {
            try {
                await cleanupFixture(prisma, fixture);
            } finally {
                await prisma.$disconnect();
            }
        }
    });

    it("cross workspace assignee rejected", async () => {
        const prisma = new PrismaClient();
        const fixture = await createFixture(prisma);
        const actor = { id: fixture.userIds.actor, role: "MEMBER" as const, departmentIds: [] };

        try {
            const task = await prisma.task.create({
                data: {
                    id: `w05-assignee-${randomUUID()}`,
                    title: "W05 assignee guard",
                    workspaceId: fixture.workspaceAId,
                    createdById: fixture.userIds.actor,
                    isPrivate: false,
                },
            });
            fixture.taskIds.push(task.id);

            await expect(
                updateTask(
                    task.id,
                    {
                        workspaceId: fixture.workspaceAId,
                        assigneeIds: [fixture.userIds.assigneeB],
                    } as any,
                    actor,
                    prisma,
                ),
            ).rejects.toThrow("cross workspace assignee rejected");

            const accepted = await updateTask(
                task.id,
                {
                    workspaceId: fixture.workspaceAId,
                    assigneeIds: [fixture.userIds.assigneeA],
                } as any,
                actor,
                prisma,
            );
            expect(accepted.assignments.map((assignment: { userId: string }) => assignment.userId)).toEqual([
                fixture.userIds.assigneeA,
            ]);
        } finally {
            try {
                await cleanupFixture(prisma, fixture);
            } finally {
                await prisma.$disconnect();
            }
        }
    });

    it("counts exclude inaccessible records", async () => {
        const prisma = new PrismaClient();
        const fixture = await createFixture(prisma);
        const actor = { id: fixture.userIds.actor, role: "MEMBER" as const, departmentIds: [] };

        try {
            const baselineVisibleTaskCount = await countTasksForActor({}, actor, prisma, fixture.workspaceAId);
            const taskRows = [
                {
                    id: `w05-count-a-${randomUUID()}`,
                    title: "W05 A task",
                    workspaceId: fixture.workspaceAId,
                    createdById: fixture.userIds.actor,
                    isPrivate: false,
                },
                {
                    id: `w05-count-b-${randomUUID()}`,
                    title: "W05 B task",
                    workspaceId: fixture.workspaceBId,
                    createdById: fixture.userIds.actor,
                    isPrivate: false,
                },
                {
                    id: `w05-count-legacy-${randomUUID()}`,
                    title: "W05 legacy task",
                    workspaceId: null,
                    createdById: fixture.userIds.actor,
                    isPrivate: false,
                },
            ];
            await prisma.task.createMany({ data: taskRows });
            fixture.taskIds.push(...taskRows.map((task) => task.id));

            const projectRows = [
                {
                    id: `w05-project-a-${randomUUID()}`,
                    name: "W05 A project",
                    workspaceId: fixture.workspaceAId,
                },
                {
                    id: `w05-project-b-${randomUUID()}`,
                    name: "W05 B project",
                    workspaceId: fixture.workspaceBId,
                },
                {
                    id: `w05-project-legacy-${randomUUID()}`,
                    name: "W05 legacy project",
                    workspaceId: null,
                },
            ];
            await prisma.project.createMany({ data: projectRows });
            fixture.projectIds.push(...projectRows.map((project) => project.id));

            const visibleTasks = await listTasksForActor({}, actor, prisma, fixture.workspaceAId);
            const taskCount = await countTasksForActor({}, actor, prisma, fixture.workspaceAId);
            const visibleProjects = await listProjectsForActor({}, actor, prisma, fixture.workspaceAId);

            expect(visibleTasks.map((task: any) => task.id)).toEqual(
                expect.arrayContaining([taskRows[0].id, taskRows[2].id]),
            );
            expect(visibleTasks.some((task: any) => task.id === taskRows[1].id)).toBe(false);
            expect(taskCount).toBe(baselineVisibleTaskCount + 2);
            expect(visibleProjects.map((project: any) => project.id)).toEqual(
                expect.arrayContaining([projectRows[0].id, projectRows[2].id]),
            );
            expect(visibleProjects.some((project: any) => project.id === projectRows[1].id)).toBe(false);
        } finally {
            try {
                await cleanupFixture(prisma, fixture);
            } finally {
                await prisma.$disconnect();
            }
        }
    });
});
