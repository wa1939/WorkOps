import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PMO_EMAILS, PMO_IDS, PMO_PASSWORD } from "./helpers/pmo";
import { assertLocalDatabaseUrl } from "../scripts/assert-local-database";

assertLocalDatabaseUrl(process.env.DATABASE_URL ?? "", { requireDatabaseSuffix: "_test" });

const users: Record<keyof typeof PMO_EMAILS, { name: string; role: Role; isActive: boolean }> = {
    admin: { name: "E2E PMO Admin", role: "ADMIN", isActive: true },
    manager: { name: "E2E PMO Manager", role: "MANAGER", isActive: true },
    owner: { name: "E2E PMO Owner", role: "MEMBER", isActive: true },
    parentOwner: { name: "E2E PMO Parent Owner", role: "MEMBER", isActive: true },
    member: { name: "E2E PMO Member", role: "MEMBER", isActive: true },
    viewer: { name: "E2E PMO Viewer", role: "VIEWER", isActive: true },
    inactive: { name: "E2E PMO Inactive", role: "MEMBER", isActive: false },
};

const PRIVACY_IDS = {
    alice: "e2e-priv-alice",
    bob: "e2e-priv-bob",
    task: "e2e-priv-task",
    note: "e2e-priv-note",
    project: "e2e-priv-project",
} as const;
const PRIVACY_EMAILS = {
    alice: "e2e-priv-alice@test.com",
    bob: "e2e-priv-bob@test.com",
} as const;

export default async function globalSetup() {
    const prisma = new PrismaClient();
    try {
        const password = await bcrypt.hash(PMO_PASSWORD, 10);
        const taskIds = (await prisma.task.findMany({
            where: {
                OR: [
                    { title: { startsWith: "e2e-pmo-" } },
                    { title: { startsWith: "e2e-priv-" } },
                    { id: PRIVACY_IDS.task },
                ],
            },
            select: { id: true },
        })).map(({ id }) => id);

        if (taskIds.length) {
            await prisma.auditLog.deleteMany({ where: { taskId: { in: taskIds } } });
            await prisma.notification.deleteMany({
                where: { linkUrl: { in: taskIds.map((id) => `/tasks/${id}#follow-up`) } },
            });
            await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
        }

        await prisma.notePage.deleteMany({
            where: {
                OR: [
                    { id: { startsWith: "e2e-priv-" } },
                    { title: { startsWith: "e2e-priv-" } },
                    { body: { contains: "e2e-priv-note-marker" } },
                ],
            },
        });
        await prisma.project.deleteMany({
            where: {
                OR: [
                    { id: PRIVACY_IDS.project },
                    { name: { startsWith: "e2e-priv-" } },
                ],
            },
        });

        await prisma.project.deleteMany({ where: { id: { startsWith: "e2e-pmo-", not: PMO_IDS.project } } });
        await prisma.aiPlaybook.deleteMany({ where: { id: "e2e-continuity-playbook" } });
        await prisma.caseStudy.deleteMany({ where: { id: { startsWith: "e2e-pmo-", not: PMO_IDS.caseStudy } } });
        await prisma.externalContact.deleteMany({
            where: { normalizedEmail: { startsWith: "e2e-pmo-" }, id: { not: PMO_IDS.contact } },
        });
        await prisma.workArea.deleteMany({
            where: { normalizedName: { startsWith: "e2e-pmo-" }, id: { not: PMO_IDS.workArea } },
        });

        const userIds = {} as Record<keyof typeof PMO_EMAILS, string>;
        for (const role of Object.keys(users) as Array<keyof typeof users>) {
            const definition = users[role];
            const user = await prisma.user.upsert({
                where: { email: PMO_EMAILS[role] },
                update: { ...definition, password, emailVerified: new Date() },
                create: { email: PMO_EMAILS[role], ...definition, password, emailVerified: new Date() },
                select: { id: true },
            });
            userIds[role] = user.id;
        }
        await prisma.user.upsert({
            where: { id: PRIVACY_IDS.alice },
            update: {
                email: PRIVACY_EMAILS.alice,
                name: "E2E Privacy Alice",
                role: "MEMBER",
                isActive: true,
                password,
                emailVerified: new Date(),
            },
            create: {
                id: PRIVACY_IDS.alice,
                email: PRIVACY_EMAILS.alice,
                name: "E2E Privacy Alice",
                role: "MEMBER",
                isActive: true,
                password,
                emailVerified: new Date(),
            },
        });
        await prisma.user.upsert({
            where: { id: PRIVACY_IDS.bob },
            update: {
                email: PRIVACY_EMAILS.bob,
                name: "E2E Privacy Bob",
                role: "MEMBER",
                isActive: true,
                password,
                emailVerified: new Date(),
            },
            create: {
                id: PRIVACY_IDS.bob,
                email: PRIVACY_EMAILS.bob,
                name: "E2E Privacy Bob",
                role: "MEMBER",
                isActive: true,
                password,
                emailVerified: new Date(),
            },
        });
        await prisma.user.update({ where: { id: userIds.owner }, data: { managerId: userIds.manager } });
        await prisma.department.upsert({
            where: { id: PMO_IDS.department },
            update: { name: "E2E PMO Department" },
            create: { id: PMO_IDS.department, name: "E2E PMO Department" },
        });
        for (const role of ["admin", "manager", "owner", "parentOwner", "member", "viewer"] as const) {
            await prisma.userDepartment.upsert({
                where: { userId_departmentId: { userId: userIds[role], departmentId: PMO_IDS.department } },
                update: {},
                create: { userId: userIds[role], departmentId: PMO_IDS.department },
            });
        }

        await prisma.user.upsert({
            where: { email: "e2e-test@test.com" },
            update: { password, role: "ADMIN", isActive: true, emailVerified: new Date() },
            create: { email: "e2e-test@test.com", name: "E2E Test User", password, role: "ADMIN", isActive: true, emailVerified: new Date() },
        });
        await prisma.workArea.upsert({
            where: { id: PMO_IDS.workArea },
            update: { name: "E2E PMO Area", normalizedName: "e2e-pmo-area", isArchived: false },
            create: { id: PMO_IDS.workArea, name: "E2E PMO Area", normalizedName: "e2e-pmo-area", createdById: userIds.admin },
        });
        await prisma.project.upsert({
            where: { id: PMO_IDS.project },
            update: { name: "E2E PMO Project", ownerId: userIds.parentOwner, workAreaId: PMO_IDS.workArea },
            create: { id: PMO_IDS.project, name: "E2E PMO Project", ownerId: userIds.parentOwner, workAreaId: PMO_IDS.workArea },
        });
        await prisma.project.create({
            data: {
                id: PRIVACY_IDS.project,
                name: "e2e-priv-project-marker",
                ownerId: PRIVACY_IDS.alice,
            },
        });
        await prisma.notePage.create({
            data: {
                id: PRIVACY_IDS.note,
                title: "e2e-priv-note-marker",
                body: "e2e-priv-note-marker",
                isShared: false,
                authorId: PRIVACY_IDS.alice,
            },
        });
        await prisma.task.create({
            data: {
                id: PRIVACY_IDS.task,
                title: "e2e-priv-search-marker",
                isPrivate: true,
                createdById: PRIVACY_IDS.alice,
                projectId: PMO_IDS.project,
                assignments: { create: [{ userId: PRIVACY_IDS.alice }] },
            },
        });
        await prisma.caseStudy.upsert({
            where: { id: PMO_IDS.caseStudy },
            update: { name: "E2E PMO Case", ownerId: userIds.parentOwner, workAreaId: PMO_IDS.workArea },
            create: { id: PMO_IDS.caseStudy, name: "E2E PMO Case", ownerId: userIds.parentOwner, workAreaId: PMO_IDS.workArea },
        });
        await prisma.projectMember.upsert({
            where: { projectId_userId: { projectId: PMO_IDS.project, userId: userIds.owner } },
            update: {},
            create: { projectId: PMO_IDS.project, userId: userIds.owner },
        });
        await prisma.caseStudyMember.upsert({
            where: { caseStudyId_userId: { caseStudyId: PMO_IDS.caseStudy, userId: userIds.owner } },
            update: {},
            create: { caseStudyId: PMO_IDS.caseStudy, userId: userIds.owner },
        });
        await prisma.externalContact.upsert({
            where: { id: PMO_IDS.contact },
            update: { name: "E2E PMO External", email: "e2e-pmo-external@test.com", normalizedEmail: "e2e-pmo-external@test.com", isArchived: false },
            create: {
                id: PMO_IDS.contact,
                name: "E2E PMO External",
                email: "e2e-pmo-external@test.com",
                normalizedEmail: "e2e-pmo-external@test.com",
                createdById: userIds.admin,
            },
        });
        // Synthetic report used by the real submit -> proposal -> approval flow.
        // The loopback database guard above applies before this write as well.
        const report = {
            title: "Synthetic browser learning report",
            body: "Synthetic report body for isolated acceptance only.",
            aiSummary: "Synthetic original draft for isolated acceptance only.",
            weekStart: new Date("2026-01-04T00:00:00Z"),
            weekEnd: new Date("2026-01-10T23:59:59Z"),
            finalBody: null,
            submittedAt: null,
        };
        await prisma.weeklyReport.upsert({
            where: { id: "e2e-report-learning" },
            create: { id: "e2e-report-learning", ...report },
            update: report,
        });
    } finally {
        await prisma.$disconnect();
    }
}
