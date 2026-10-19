import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";
import { toDatabaseDate } from "./date";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    assertLocalDatabaseUrl(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

describe.runIf(databaseEnabled)("PMO DATE persistence", () => {
    it("round-trips the intended calendar date through PostgreSQL DATE", async () => {
        const prisma = new PrismaClient();
        const suffix = randomUUID();
        const ids = {
            user: `date-user-${suffix}`,
            area: `date-area-${suffix}`,
            project: `date-project-${suffix}`,
            contact: `date-contact-${suffix}`,
            task: `date-task-${suffix}`,
            action: `date-action-${suffix}`,
            event: `date-event-${suffix}`,
        };
        try {
            await prisma.user.create({ data: { id: ids.user, email: `${ids.user}@example.test`, name: "Date Test", role: "MEMBER" } });
            await prisma.workArea.create({ data: { id: ids.area, name: ids.area, normalizedName: ids.area, createdById: ids.user } });
            await prisma.project.create({ data: { id: ids.project, name: ids.project, ownerId: ids.user, workAreaId: ids.area } });
            await prisma.externalContact.create({ data: { id: ids.contact, name: "Date Contact", email: `${ids.contact}@example.test`, normalizedEmail: `${ids.contact}@example.test`, createdById: ids.user } });
            await prisma.task.create({ data: { id: ids.task, title: "Date boundary", type: "EXTERNAL_ACTION", status: "WAITING", dueAt: new Date("2026-08-12T12:00:00.000Z"), projectId: ids.project, isPrivate: false } });
            await prisma.externalAction.create({ data: { id: ids.action, taskId: ids.task, ownerId: ids.user, externalContactId: ids.contact } });
            await prisma.followUpEvent.create({ data: { id: ids.event, externalActionId: ids.action, triggerType: "DUE", scheduledDate: toDatabaseDate("2026-08-12"), dedupKey: ids.event, ownerId: ids.user } });

            const persisted = await prisma.followUpEvent.findUniqueOrThrow({ where: { id: ids.event }, select: { scheduledDate: true } });
            expect(persisted.scheduledDate.toISOString().slice(0, 10)).toBe("2026-08-12");
        } finally {
            await prisma.task.deleteMany({ where: { id: ids.task } });
            await prisma.project.deleteMany({ where: { id: ids.project } });
            await prisma.externalContact.deleteMany({ where: { id: ids.contact } });
            await prisma.workArea.deleteMany({ where: { id: ids.area } });
            await prisma.user.deleteMany({ where: { id: ids.user } });
            await prisma.$disconnect();
        }
    });
});
