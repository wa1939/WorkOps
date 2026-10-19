import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    assertLocalDatabaseUrl(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

describe.runIf(databaseEnabled)("workspace schema", () => {
    it("workspace and membership tables enforce uniqueness and roles", async () => {
        const prisma = new PrismaClient();
        const suffix = randomUUID();
        const workspaceId = `workspace-${suffix}`;
        const userIds = [`workspace-user-a-${suffix}`, `workspace-user-b-${suffix}`];
        const workspaceSlug = `workspace-${suffix}`;
        let workspaceCreated = false;

        try {
            await prisma.workspace.create({
                data: {
                    id: workspaceId,
                    slug: workspaceSlug,
                    name: "Workspace uniqueness fixture",
                },
            });
            workspaceCreated = true;

            for (let index = 0; index < userIds.length; index += 1) {
                const userId = userIds[index];
                await prisma.user.create({
                    data: {
                        id: userId,
                        email: `${userId}@example.test`,
                        name: `Workspace User ${index + 1}`,
                    },
                });
            }

            const firstMember = await prisma.workspaceMember.create({
                data: { workspaceId, userId: userIds[0] },
            });
            await prisma.workspaceMember.create({
                data: { workspaceId, userId: userIds[1] },
            });

            expect(firstMember.role).toBe("MEMBER");
            await expect(
                prisma.workspaceMember.create({
                    data: { workspaceId, userId: userIds[0] },
                }),
            ).rejects.toMatchObject({ code: "P2002" });

            await expect(
                prisma.workspace.create({
                    data: {
                        id: `duplicate-slug-${suffix}`,
                        slug: workspaceSlug,
                        name: "Duplicate slug fixture",
                    },
                }),
            ).rejects.toMatchObject({ code: "P2002" });
        } finally {
            try {
                if (workspaceCreated) {
                    await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
                    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
                    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
                }
            } finally {
                await prisma.$disconnect();
            }
        }
    });

    it("root operational models accept workspace linkage", async () => {
        const prisma = new PrismaClient();
        const suffix = randomUUID();
        const workspaceId = `workspace-roots-${suffix}`;
        const userId = `workspace-roots-user-${suffix}`;
        const ids = {
            task: `workspace-task-${suffix}`,
            unscopedTask: `workspace-unscoped-task-${suffix}`,
            project: `workspace-project-${suffix}`,
            kpi: `workspace-kpi-${suffix}`,
            notePage: `workspace-note-${suffix}`,
            caseStudy: `workspace-case-study-${suffix}`,
            weeklyReport: `workspace-report-${suffix}`,
            supportRequest: `workspace-support-${suffix}`,
            announcement: `workspace-announcement-${suffix}`,
            department: `workspace-department-${suffix}`,
        };
        let workspaceCreated = false;

        try {
            await prisma.workspace.create({
                data: {
                    id: workspaceId,
                    slug: `workspace-roots-${suffix}`,
                    name: "Workspace roots fixture",
                },
            });
            workspaceCreated = true;

            await prisma.user.create({
                data: {
                    id: userId,
                    email: `${userId}@example.test`,
                    name: "Workspace Roots User",
                },
            });

            await prisma.task.create({
                data: { id: ids.task, title: "Workspace task", workspaceId },
            });
            await prisma.project.create({
                data: { id: ids.project, name: "Workspace project", workspaceId },
            });
            await prisma.kPI.create({
                data: {
                    id: ids.kpi,
                    perspective: "Workspace",
                    objective: "Workspace objective",
                    name: "Workspace KPI",
                    workspaceId,
                },
            });
            await prisma.notePage.create({
                data: {
                    id: ids.notePage,
                    title: "Workspace note",
                    body: "Workspace note body",
                    workspaceId,
                },
            });
            await prisma.caseStudy.create({
                data: { id: ids.caseStudy, name: "Workspace case study", workspaceId },
            });
            await prisma.weeklyReport.create({
                data: {
                    id: ids.weeklyReport,
                    weekStart: new Date("2026-09-06T00:00:00.000Z"),
                    weekEnd: new Date("2026-09-12T00:00:00.000Z"),
                    title: "Workspace weekly report",
                    body: "Workspace weekly report body",
                    workspaceId,
                },
            });
            await prisma.supportRequest.create({
                data: {
                    id: ids.supportRequest,
                    requesterId: userId,
                    title: "Workspace support request",
                    workspaceId,
                },
            });
            await prisma.announcement.create({
                data: {
                    id: ids.announcement,
                    title: "Workspace announcement",
                    body: "Workspace announcement body",
                    workspaceId,
                },
            });
            await prisma.department.create({
                data: {
                    id: ids.department,
                    name: `Workspace Department ${suffix}`,
                    workspaceId,
                },
            });
            await prisma.task.create({
                data: { id: ids.unscopedTask, title: "Unscoped workspace task" },
            });

            const linkedRoots = await Promise.all([
                prisma.task.findUniqueOrThrow({ where: { id: ids.task }, include: { workspace: true } }),
                prisma.project.findUniqueOrThrow({ where: { id: ids.project }, include: { workspace: true } }),
                prisma.kPI.findUniqueOrThrow({ where: { id: ids.kpi }, include: { workspace: true } }),
                prisma.notePage.findUniqueOrThrow({ where: { id: ids.notePage }, include: { workspace: true } }),
                prisma.caseStudy.findUniqueOrThrow({ where: { id: ids.caseStudy }, include: { workspace: true } }),
                prisma.weeklyReport.findUniqueOrThrow({ where: { id: ids.weeklyReport }, include: { workspace: true } }),
                prisma.supportRequest.findUniqueOrThrow({ where: { id: ids.supportRequest }, include: { workspace: true } }),
                prisma.announcement.findUniqueOrThrow({ where: { id: ids.announcement }, include: { workspace: true } }),
                prisma.department.findUniqueOrThrow({ where: { id: ids.department }, include: { workspace: true } }),
            ]);

            for (const root of linkedRoots) {
                expect(root.workspace?.id).toBe(workspaceId);
            }

            const unscopedRoot = await prisma.task.findUniqueOrThrow({
                where: { id: ids.unscopedTask },
            });
            expect(unscopedRoot.workspaceId).toBeNull();
        } finally {
            try {
                if (workspaceCreated) {
                    await prisma.supportRequest.deleteMany({ where: { id: ids.supportRequest } });
                    await prisma.announcement.deleteMany({ where: { id: ids.announcement } });
                    await prisma.weeklyReport.deleteMany({ where: { id: ids.weeklyReport } });
                    await prisma.notePage.deleteMany({ where: { id: ids.notePage } });
                    await prisma.task.deleteMany({ where: { id: { in: [ids.task, ids.unscopedTask] } } });
                    await prisma.caseStudy.deleteMany({ where: { id: ids.caseStudy } });
                    await prisma.project.deleteMany({ where: { id: ids.project } });
                    await prisma.kPI.deleteMany({ where: { id: ids.kpi } });
                    await prisma.department.deleteMany({ where: { id: ids.department } });
                    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
                    await prisma.user.deleteMany({ where: { id: userId } });
                }
            } finally {
                await prisma.$disconnect();
            }
        }
    });

    it("workspace member roles cover the four roles", async () => {
        const prisma = new PrismaClient();
        const suffix = randomUUID();
        const workspaceId = `workspace-roles-${suffix}`;
        const userIds = [
            `workspace-owner-${suffix}`,
            `workspace-admin-${suffix}`,
            `workspace-member-${suffix}`,
            `workspace-viewer-${suffix}`,
        ];
        const roles = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
        let workspaceCreated = false;

        try {
            await prisma.workspace.create({
                data: {
                    id: workspaceId,
                    slug: `workspace-roles-${suffix}`,
                    name: "Workspace roles fixture",
                },
            });
            workspaceCreated = true;

            for (let index = 0; index < userIds.length; index += 1) {
                const userId = userIds[index];
                await prisma.user.create({
                    data: {
                        id: userId,
                        email: `${userId}@example.test`,
                        name: `Workspace Role User ${index + 1}`,
                    },
                });
            }

            for (let index = 0; index < roles.length; index += 1) {
                const role = roles[index];
                await prisma.workspaceMember.create({
                    data: { workspaceId, userId: userIds[index], role },
                });
            }

            const persistedRoles = await prisma.workspaceMember.findMany({
                where: { workspaceId },
                select: { role: true },
            });
            expect(persistedRoles.map(({ role }) => role).sort()).toEqual([...roles].sort());
        } finally {
            try {
                if (workspaceCreated) {
                    await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
                    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
                    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
                }
            } finally {
                await prisma.$disconnect();
            }
        }
    });
});
