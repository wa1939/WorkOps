import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    assertLocalDatabaseUrl(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth }));

let deleteProject: typeof import("./projects/[id]/route").DELETE;
let deleteCaseStudy: typeof import("./case-studies/[id]/route").DELETE;

function params(id: string) {
    return { params: Promise.resolve({ id }) };
}

async function createPmoFixture(db: PrismaClient, kind: "project" | "caseStudy") {
    const suffix = randomUUID();
    const ids = {
        user: `parent-delete-user-${suffix}`,
        area: `parent-delete-area-${suffix}`,
        parent: `parent-delete-${kind}-${suffix}`,
        contact: `parent-delete-contact-${suffix}`,
        task: `parent-delete-task-${suffix}`,
        action: `parent-delete-action-${suffix}`,
        reminder: `parent-delete-reminder-${suffix}`,
        followUp: `parent-delete-follow-up-${suffix}`,
        evidence: `parent-delete-evidence-${suffix}`,
    };

    await db.user.create({
        data: { id: ids.user, email: `${ids.user}@example.test`, name: "Parent deletion test", role: "ADMIN" },
    });
    await db.workArea.create({
        data: { id: ids.area, name: ids.area, normalizedName: ids.area, createdById: ids.user },
    });
    if (kind === "project") {
        await db.project.create({
            data: { id: ids.parent, name: ids.parent, ownerId: ids.user, workAreaId: ids.area },
        });
    } else {
        await db.caseStudy.create({
            data: { id: ids.parent, name: ids.parent, ownerId: ids.user, workAreaId: ids.area },
        });
    }
    await db.externalContact.create({
        data: {
            id: ids.contact,
            name: ids.contact,
            email: `${ids.contact}@example.test`,
            normalizedEmail: `${ids.contact}@example.test`,
            createdById: ids.user,
        },
    });
    await db.task.create({
        data: {
            id: ids.task,
            title: ids.task,
            type: "EXTERNAL_ACTION",
            status: "WAITING",
            priority: "MEDIUM",
            dueAt: new Date("2026-12-31T12:00:00.000Z"),
            projectId: kind === "project" ? ids.parent : null,
            caseStudyId: kind === "caseStudy" ? ids.parent : null,
            createdById: ids.user,
            isPrivate: false,
        },
    });
    await db.externalAction.create({
        data: { id: ids.action, taskId: ids.task, ownerId: ids.user, externalContactId: ids.contact },
    });
    await db.reminderRule.create({
        data: { id: ids.reminder, externalActionId: ids.action, daysBeforeDue: 2 },
    });
    await db.followUpEvent.create({
        data: {
            id: ids.followUp,
            externalActionId: ids.action,
            triggerType: "DUE",
            scheduledDate: new Date("2026-12-31T00:00:00.000Z"),
            dedupKey: ids.followUp,
            ownerId: ids.user,
        },
    });
    await db.actionEvidence.create({
        data: {
            id: ids.evidence,
            externalActionId: ids.action,
            label: "Preserved evidence",
            url: "https://example.test/evidence",
            addedById: ids.user,
        },
    });

    return ids;
}

async function cleanupFixture(db: PrismaClient, ids: Awaited<ReturnType<typeof createPmoFixture>>) {
    await db.actionEvidence.deleteMany({ where: { id: ids.evidence } });
    await db.followUpEvent.deleteMany({ where: { id: ids.followUp } });
    await db.reminderRule.deleteMany({ where: { id: ids.reminder } });
    await db.externalAction.deleteMany({ where: { id: ids.action } });
    await db.task.deleteMany({ where: { id: ids.task } });
    await db.project.deleteMany({ where: { id: ids.parent } });
    await db.caseStudy.deleteMany({ where: { id: ids.parent } });
    await db.externalContact.deleteMany({ where: { id: ids.contact } });
    await db.workArea.deleteMany({ where: { id: ids.area } });
    await db.user.deleteMany({ where: { id: ids.user } });
}

describe.runIf(databaseEnabled)("parent deletion PMO safety", () => {
    beforeAll(async () => {
        deleteProject = (await import("./projects/[id]/route")).DELETE;
        deleteCaseStudy = (await import("./case-studies/[id]/route")).DELETE;
    });

    it("returns 409 and preserves project PMO history", async () => {
        const db = new PrismaClient();
        const ids = await createPmoFixture(db, "project");
        try {
            auth.mockResolvedValue({ user: { id: ids.user, role: "ADMIN" } });
            const response = await deleteProject(
                new Request(`http://localhost/api/projects/${ids.parent}`, { method: "DELETE" }),
                params(ids.parent),
            );

            expect(response.status).toBe(409);
            await expect(db.project.findUnique({ where: { id: ids.parent } })).resolves.not.toBeNull();
            await expect(db.task.findUnique({ where: { id: ids.task } })).resolves.toMatchObject({
                id: ids.task,
                type: "EXTERNAL_ACTION",
                projectId: ids.parent,
            });
            await expect(db.externalAction.findUnique({ where: { id: ids.action } })).resolves.not.toBeNull();
            await expect(db.followUpEvent.findUnique({ where: { id: ids.followUp } })).resolves.not.toBeNull();
            await expect(db.actionEvidence.findUnique({ where: { id: ids.evidence } })).resolves.not.toBeNull();
        } finally {
            await cleanupFixture(db, ids);
            await db.$disconnect();
        }
    });

    it("returns 409 and preserves case-study PMO history", async () => {
        const db = new PrismaClient();
        const ids = await createPmoFixture(db, "caseStudy");
        try {
            auth.mockResolvedValue({ user: { id: ids.user, role: "ADMIN" } });
            const response = await deleteCaseStudy(
                new Request(`http://localhost/api/case-studies/${ids.parent}`, { method: "DELETE" }),
                params(ids.parent),
            );

            expect(response.status).toBe(409);
            await expect(db.caseStudy.findUnique({ where: { id: ids.parent } })).resolves.not.toBeNull();
            await expect(db.task.findUnique({ where: { id: ids.task } })).resolves.toMatchObject({
                id: ids.task,
                type: "EXTERNAL_ACTION",
                caseStudyId: ids.parent,
            });
            await expect(db.externalAction.findUnique({ where: { id: ids.action } })).resolves.not.toBeNull();
            await expect(db.followUpEvent.findUnique({ where: { id: ids.followUp } })).resolves.not.toBeNull();
            await expect(db.actionEvidence.findUnique({ where: { id: ids.evidence } })).resolves.not.toBeNull();
        } finally {
            await cleanupFixture(db, ids);
            await db.$disconnect();
        }
    });

    it("uses a parent FOR UPDATE lock that blocks a concurrent PMO insert", async () => {
        const db = new PrismaClient();
        const locker = new PrismaClient();
        const ids = await createPmoFixture(db, "project");
        let releaseLock!: () => void;
        let signalLocked!: () => void;
        const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
        const release = new Promise<void>((resolve) => { releaseLock = resolve; });

        try {
            await db.actionEvidence.deleteMany({ where: { id: ids.evidence } });
            await db.followUpEvent.deleteMany({ where: { id: ids.followUp } });
            await db.reminderRule.deleteMany({ where: { id: ids.reminder } });
            await db.externalAction.deleteMany({ where: { id: ids.action } });
            await db.task.deleteMany({ where: { id: ids.task } });

            const deletion = locker.$transaction(async (tx) => {
                await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${ids.parent} FOR UPDATE`;
                signalLocked();
                await release;
                await tx.project.delete({ where: { id: ids.parent } });
            });
            await locked;

            const concurrentInsert = db.task.create({
                data: {
                    id: ids.task,
                    title: ids.task,
                    type: "EXTERNAL_ACTION",
                    status: "WAITING",
                    priority: "MEDIUM",
                    dueAt: new Date("2026-12-31T12:00:00.000Z"),
                    projectId: ids.parent,
                    createdById: ids.user,
                    isPrivate: false,
                },
            });
            const raceResult = await Promise.race([
                concurrentInsert.then(() => "created" as const, () => "rejected" as const),
                new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100)),
            ]);
            expect(raceResult).toBe("blocked");

            releaseLock();
            await deletion;
            await expect(concurrentInsert).rejects.toBeTruthy();
        } finally {
            releaseLock?.();
            await cleanupFixture(db, ids);
            await locker.$disconnect();
            await db.$disconnect();
        }
    });
});
