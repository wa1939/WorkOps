import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { processPmoReminderRun } from "../src/lib/pmo/reminder-service";
import { toDatabaseDate, toRiyadhDate } from "../src/lib/pmo/date";
import { loginAs } from "./helpers/auth";
import { createPmoAction, PMO_EMAILS, pmoName, withPmoPrisma } from "./helpers/pmo";

async function seedDeliveryEvent(taskId: string, externalActionId: string, eventId: string, state: "PENDING" | "FAILED" = "PENDING") {
    return withPmoPrisma(async (prisma) => {
        const owner = await prisma.user.findUniqueOrThrow({ where: { email: PMO_EMAILS.owner } });
        await prisma.followUpEvent.create({
            data: {
                id: eventId,
                externalActionId,
                triggerType: "MANUAL",
                scheduledDate: toDatabaseDate("2026-10-01"),
                dedupKey: eventId,
                ownerId: owner.id,
                ownerEmailState: state,
                ownerEmailAttempts: state === "FAILED" ? 1 : 0,
            },
        });
        return { ownerId: owner.id, taskId };
    });
}

test.describe.serial("PMO reminders", () => {
    test.beforeEach(async ({ page }) => loginAs(page, "owner"));

    test("deduplicates the real cron and records safe failed delivery state at UTC noon", async ({ page }) => {
        const dueDate = toRiyadhDate(new Date());
        const created = await createPmoAction(page.request, "cron-idempotency", { dueDate });
        await withPmoPrisma((prisma) => prisma.task.updateMany({
            where: { title: { startsWith: "e2e-pmo-" }, id: { not: created.taskId }, status: { notIn: ["DONE", "CANCELED"] } },
            data: { status: "CANCELED" },
        }));
        const headers = { Authorization: `Bearer ${process.env.CRON_SECRET}` };

        const first = await page.request.get("/api/cron/pmo-reminders", { headers });
        const second = await page.request.get("/api/cron/pmo-reminders", { headers });
        expect(first.status()).toBe(200);
        expect(second.status()).toBe(200);
        expect(await first.json()).toMatchObject({ eventsCreated: 1, notificationsCreated: 1, emailsFailed: 1 });
        expect(await second.json()).toMatchObject({ eventsCreated: 0, notificationsCreated: 0, emailsFailed: 1, emailsRetried: 1 });

        await withPmoPrisma(async (prisma) => {
            const events = await prisma.followUpEvent.findMany({ where: { externalActionId: created.externalActionId } });
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({ ownerEmailState: "FAILED", ownerEmailAttempts: 2, ownerEmailProviderId: null });
            expect(events[0].scheduledDate.toISOString().slice(0, 10)).toBe(dueDate);
            expect(await prisma.notification.count({ where: { linkUrl: `/tasks/${created.taskId}#follow-up` } })).toBe(1);
        });

        expect((await page.request.get("/api/cron/due-reminders", { headers })).status()).toBe(200);
        await withPmoPrisma(async (prisma) => {
            expect(await prisma.notification.count({ where: { linkUrl: `/tasks/${created.taskId}` } })).toBe(0);
            await prisma.task.update({ where: { id: created.taskId }, data: { status: "CANCELED" } });
        });
    });

    test("persists provider identity and retries a failed deterministic delivery with the same event key", async ({ page }) => {
        const created = await createPmoAction(page.request, "provider-retry");
        const eventId = pmoName("provider-retry-event");
        await seedDeliveryEvent(created.taskId, created.externalActionId, eventId);
        const keys: string[] = [];
        let shouldFail = true;

        await withPmoPrisma(async (prisma) => {
            const sender = async ({ idempotencyKey }: { idempotencyKey: string }) => {
                keys.push(idempotencyKey);
                if (shouldFail) throw new Error("e2e-pmo-deterministic-provider-failure");
                return { id: "e2e-pmo-provider-delivery" };
            };
            const first = await processPmoReminderRun({ now: new Date("2026-10-01T06:00:00.000Z"), db: prisma, sendOwnerEmail: sender });
            expect(first).toMatchObject({ emailsFailed: 1, emailsSent: 0, emailsRetried: 0 });
            shouldFail = false;
            const second = await processPmoReminderRun({ now: new Date("2026-10-01T06:01:00.000Z"), db: prisma, sendOwnerEmail: sender });
            expect(second).toMatchObject({ emailsFailed: 0, emailsSent: 1, emailsRetried: 1 });
            const event = await prisma.followUpEvent.findUniqueOrThrow({ where: { id: eventId } });
            expect(event).toMatchObject({ ownerEmailState: "SENT", ownerEmailAttempts: 2, ownerEmailProviderId: "e2e-pmo-provider-delivery", ownerEmailLastError: null });
            await prisma.task.update({ where: { id: created.taskId }, data: { status: "CANCELED" } });
        });
        expect(keys).toEqual([eventId, eventId]);
    });

    test("reuses provider idempotency after send succeeds but persistence fails", async ({ page }) => {
        const created = await createPmoAction(page.request, "provider-persistence-retry");
        const eventId = pmoName("provider-persistence-retry-event");
        await seedDeliveryEvent(created.taskId, created.externalActionId, eventId);
        const keys: string[] = [];
        const prisma = new PrismaClient();
        let rejectSentWrite = true;
        const followUpEvent = new Proxy(prisma.followUpEvent, {
            get(target, property, receiver) {
                if (property === "update") {
                    return async (args: { data?: { ownerEmailState?: string } }) => {
                        if (rejectSentWrite && args.data?.ownerEmailState === "SENT") {
                            rejectSentWrite = false;
                            throw new Error("e2e-pmo-persistence-failure");
                        }
                        return prisma.followUpEvent.update(args as Parameters<typeof prisma.followUpEvent.update>[0]);
                    };
                }
                const value = Reflect.get(target, property, receiver);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
        const db = new Proxy(prisma, {
            get(target, property, receiver) {
                if (property === "followUpEvent") return followUpEvent;
                const value = Reflect.get(target, property, receiver);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
        const sender = async ({ idempotencyKey }: { idempotencyKey: string }) => {
            keys.push(idempotencyKey);
            return { id: "e2e-pmo-provider-after-persistence-retry" };
        };

        try {
            const first = await processPmoReminderRun({ now: new Date("2026-10-02T06:00:00.000Z"), db: db as PrismaClient, sendOwnerEmail: sender });
            expect(first).toMatchObject({ emailsFailed: 1, emailsSent: 0 });
            const second = await processPmoReminderRun({ now: new Date("2026-10-02T06:01:00.000Z"), db: prisma, sendOwnerEmail: sender });
            expect(second).toMatchObject({ emailsSent: 1, emailsRetried: 1 });
            expect(await prisma.followUpEvent.findUniqueOrThrow({ where: { id: eventId } })).toMatchObject({
                ownerEmailState: "SENT",
                ownerEmailAttempts: 2,
                ownerEmailProviderId: "e2e-pmo-provider-after-persistence-retry",
            });
        } finally {
            await prisma.task.update({ where: { id: created.taskId }, data: { status: "CANCELED" } });
            await prisma.$disconnect();
        }
        expect(keys).toEqual([eventId, eventId]);
    });
});
