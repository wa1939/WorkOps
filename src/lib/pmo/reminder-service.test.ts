import { describe, expect, it, vi } from "vitest";
import { processPmoReminderRun } from "./reminder-service";

function databaseFixture({
    actions = [],
    deliverables = [],
}: { actions?: unknown[]; deliverables?: unknown[] } = {}) {
    const events = new Map<string, any>();
    const deliveries: any[] = [];
    const notifications: any[] = [];
    const db: any = {
        externalAction: { findMany: vi.fn().mockResolvedValue(actions) },
        followUpEvent: {
            create: vi.fn().mockResolvedValue({ id: "event-1" }),
            update: vi.fn().mockResolvedValue({}),
            findMany: vi.fn().mockResolvedValue(deliverables),
        },
        notification: {
            create: vi.fn().mockImplementation(({ data }) => {
                const notification = { id: `notification-${notifications.length + 1}`, ...data };
                notifications.push(notification);
                return Promise.resolve(notification);
            }),
        },
        notificationEvent: {
            upsert: vi.fn().mockImplementation(({ create }: { create: any }) => {
                const existing = events.get(create.dedupeKey);
                if (existing) return Promise.resolve(existing);
                const stored = { id: create.id, sourceVersion: create.sourceVersion };
                events.set(create.dedupeKey, stored);
                return Promise.resolve(stored);
            }),
        },
        delivery: {
            createMany: vi.fn().mockImplementation(({ data }: { data: any[] }) => {
                deliveries.push(...data);
                return Promise.resolve({ count: data.length });
            }),
        },
    };
    db.$transaction = vi.fn(async (callback: (tx: any) => unknown) => callback(db));
    return { db, deliveries, notifications, events };
}

const action = {
    id: "action-1",
    ownerId: "owner-1",
    overdueIntervalDays: 7,
    owner: { id: "owner-1", email: "owner@example.com", name: "Owner", isActive: true, quietUntil: null },
    taskId: "task-1",
    task: {
        title: "Provide report",
        dueAt: new Date("2026-08-12T06:00:00.000Z"),
        workspaceId: "workspace-1",
        project: { name: "Project" },
        caseStudy: null,
    },
    reminderRules: [{ daysBeforeDue: 0 }],
    followUpEvents: [],
};

describe("processPmoReminderRun", () => {
    it("does not deliver anything when no active external actions exist", async () => {
        const sendOwnerEmail = vi.fn();
        const { db } = databaseFixture();

        await expect(
            processPmoReminderRun({
                now: new Date("2026-07-14T05:00:00Z"),
                db,
                sendOwnerEmail,
            }),
        ).resolves.toEqual({
            eventsCreated: 0,
            notificationsCreated: 0,
            emailsQueued: 0,
            emailsSent: 0,
            emailsFailed: 0,
            emailsRetried: 0,
        });
        expect(sendOwnerEmail).not.toHaveBeenCalled();
    });

    it("writes scheduled PostgreSQL DATE values at UTC noon and queues both channels transactionally", async () => {
        const { db, deliveries, notifications } = databaseFixture({ actions: [action] });

        const result = await processPmoReminderRun({
            now: new Date("2026-08-12T05:00:00.000Z"),
            db,
            sendOwnerEmail: vi.fn(),
        });

        const scheduledDate = db.followUpEvent.create.mock.calls[0][0].data.scheduledDate as Date;
        expect(scheduledDate.toISOString()).toBe("2026-08-12T12:00:00.000Z");
        expect(result).toMatchObject({ eventsCreated: 1, notificationsCreated: 1, emailsQueued: 1 });
        expect(notifications).toHaveLength(1);
        expect(deliveries.map(({ channel }: { channel: string }) => channel)).toEqual(["in_app", "email"]);
        expect(deliveries.every(({ state }: { state: string }) => state === "PENDING")).toBe(true);
    });

    it("queues a legacy email delivery after provider failure without claiming DELIVERED", async () => {
        const deliverable = {
            id: "follow-up-event-1",
            dedupKey: "follow-up-event-1",
            ownerId: "owner-1",
            triggerType: "DUE",
            ownerEmailAttempts: 1,
            owner: { id: "owner-1", email: "owner@example.com", name: "Owner", isActive: true, quietUntil: null },
            externalAction: {
                id: "action-1",
                taskId: "task-1",
                task: { title: "Provide report", workspaceId: "workspace-1", project: { name: "Project" }, caseStudy: null },
            },
        };
        const { db, deliveries, notifications } = databaseFixture({ deliverables: [deliverable] });
        const sendOwnerEmail = vi.fn().mockRejectedValue(new Error("provider unavailable"));

        const result = await processPmoReminderRun({
            now: new Date("2026-07-14T05:00:00Z"),
            db,
            sendOwnerEmail,
        });

        expect(sendOwnerEmail).not.toHaveBeenCalled();
        expect(result).toMatchObject({ emailsQueued: 1, emailsRetried: 1, emailsSent: 0, emailsFailed: 0 });
        expect(notifications).toHaveLength(0);
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0]).toMatchObject({ channel: "email", state: "PENDING" });
        expect(deliveries.some(({ state }: { state: string }) => state === "DELIVERED")).toBe(false);
    });
});

describe("processPmoReminderRun — characterization (plan 010)", () => {
    it("constrains reminder generation to active owners — fixed by plan 014", async () => {
        const { db } = databaseFixture();
        await processPmoReminderRun({ now: new Date("2026-07-14T05:00:00Z"), db });
        const generationWhere = db.externalAction.findMany.mock.calls[0][0].where;
        expect(generationWhere).toMatchObject({ owner: { isActive: true } });
    });

    it("constrains reminder delivery to active owners — fixed by plan 014", async () => {
        const { db } = databaseFixture();
        await processPmoReminderRun({ now: new Date("2026-07-14T05:00:00Z"), db });
        const deliveryWhere = db.followUpEvent.findMany.mock.calls[0][0].where;
        expect(JSON.stringify(deliveryWhere)).toContain("isActive");
    });
});
