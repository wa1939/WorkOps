import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";
import { removeEvidence, transitionExternalAction } from "./lifecycle-service";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    assertLocalDatabaseUrl(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

describe.runIf(databaseEnabled)("PMO lifecycle PostgreSQL concurrency", () => {
    it("never commits DONE without evidence or a closure note during a close/removal race", async () => {
        const prisma = new PrismaClient();
        try {
            for (let attempt = 0; attempt < 5; attempt++) {
                const suffix = randomUUID();
                const ids = {
                    user: `e2e-pmo-concurrency-user-${suffix}`,
                    area: `e2e-pmo-concurrency-area-${suffix}`,
                    project: `e2e-pmo-concurrency-project-${suffix}`,
                    contact: `e2e-pmo-concurrency-contact-${suffix}`,
                    task: `e2e-pmo-concurrency-task-${suffix}`,
                    action: `e2e-pmo-concurrency-action-${suffix}`,
                    evidence: `e2e-pmo-concurrency-evidence-${suffix}`,
                };
                const actor = { id: ids.user, role: "MEMBER" as const };

                try {
                    await prisma.user.create({ data: { id: ids.user, email: `${ids.user}@example.test`, name: "PMO Concurrency", role: "MEMBER" } });
                    await prisma.workArea.create({ data: { id: ids.area, name: ids.area, normalizedName: ids.area, createdById: ids.user } });
                    await prisma.project.create({ data: { id: ids.project, name: ids.project, ownerId: ids.user, workAreaId: ids.area } });
                    await prisma.externalContact.create({ data: { id: ids.contact, name: ids.contact, email: `${ids.contact}@example.test`, normalizedEmail: `${ids.contact}@example.test`, createdById: ids.user } });
                    await prisma.task.create({ data: { id: ids.task, title: ids.task, type: "EXTERNAL_ACTION", status: "WAITING", dueAt: new Date("2026-12-31T12:00:00.000Z"), projectId: ids.project, createdById: ids.user, isPrivate: false } });
                    await prisma.externalAction.create({ data: { id: ids.action, taskId: ids.task, ownerId: ids.user, externalContactId: ids.contact } });
                    await prisma.actionEvidence.create({ data: { id: ids.evidence, externalActionId: ids.action, label: "Final evidence", url: "https://example.test/evidence", addedById: ids.user } });

                    await Promise.allSettled([
                        transitionExternalAction(ids.task, { action: "close" }, actor, prisma),
                        removeEvidence(ids.task, ids.evidence, actor, prisma),
                    ]);

                    const committed = await prisma.task.findUniqueOrThrow({
                        where: { id: ids.task },
                        include: { externalAction: { include: { evidence: true } } },
                    });
                    if (committed.status === "DONE") {
                        expect(Boolean(committed.externalAction?.closureNote?.trim()) || Boolean(committed.externalAction?.evidence.length)).toBe(true);
                    }
                } finally {
                    await prisma.auditLog.deleteMany({ where: { taskId: ids.task } });
                    await prisma.task.deleteMany({ where: { id: ids.task } });
                    await prisma.project.deleteMany({ where: { id: ids.project } });
                    await prisma.externalContact.deleteMany({ where: { id: ids.contact } });
                    await prisma.workArea.deleteMany({ where: { id: ids.area } });
                    await prisma.user.deleteMany({ where: { id: ids.user } });
                }
            }
        } finally {
            await prisma.$disconnect();
        }
    });
});
