import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";
import { createScopedWorkerDb } from "./test-support/scoped-worker-db";
import { processCommunicationsRun, type DeliverySender } from "./worker";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Communications worker tests require a database name ending with _test");
    }
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

const db = new PrismaClient();
const workerDbA = new PrismaClient();
const workerDbB = new PrismaClient();

type DeliverySeed = {
    id?: string;
    channel: string;
    destinationKey: string;
    state?: "PENDING" | "SENDING";
    attempts?: number;
    nextAttemptAt?: Date | null;
    leaseUntil?: Date | null;
};

type Fixture = {
    userId: string;
    eventId: string;
    deliveryIds: string[];
};

async function seedFixture(deliveries: DeliverySeed[], active = true): Promise<Fixture> {
    const suffix = randomUUID();
    const userId = `c03-user-${suffix}`;
    const eventId = `c03-event-${suffix}`;
    await db.user.create({
        data: {
            id: userId,
            email: `${userId}@example.test`,
            name: "C03 worker fixture",
            isActive: active,
        },
    });
    await db.notificationEvent.create({
        data: {
            id: eventId,
            workspaceId: `c03-workspace-${suffix}`,
            sourceType: "c03-test",
            sourceId: `source-${suffix}`,
            sourceVersion: "v1",
            category: "task",
            recipientUserId: userId,
            dedupeKey: `c03-dedupe-${suffix}`,
        },
    });
    const deliveryIds = deliveries.map((delivery) => delivery.id ?? `c03-delivery-${randomUUID()}`);
    await db.delivery.createMany({
        data: deliveries.map((delivery, index) => ({
            id: deliveryIds[index],
            eventId,
            channel: delivery.channel,
            destinationKey: delivery.destinationKey,
            state: delivery.state ?? "PENDING",
            attempts: delivery.attempts ?? 0,
            nextAttemptAt: delivery.nextAttemptAt ?? null,
            leaseUntil: delivery.leaseUntil ?? null,
        })),
    });
    return { userId, eventId, deliveryIds };
}

async function cleanup(fixture: Fixture): Promise<void> {
    await db.delivery.deleteMany({ where: { id: { in: fixture.deliveryIds } } });
    await db.notificationEvent.deleteMany({ where: { id: fixture.eventId } });
    await db.user.deleteMany({ where: { id: fixture.userId } });
}

const acceptedSender: DeliverySender = async (delivery) => ({ outcome: "accepted", providerId: `provider-${delivery.id}` });

afterAll(async () => {
    await Promise.all([db.$disconnect(), workerDbA.$disconnect(), workerDbB.$disconnect()]);
});

describe.runIf(databaseEnabled)("durable communications worker", () => {
    it("two workers claim once", async () => {
        const fixture = await seedFixture([
            { channel: "email", destinationKey: "one@example.test" },
            { channel: "email", destinationKey: "two@example.test" },
            { channel: "email", destinationKey: "three@example.test" },
        ]);
        const now = new Date("2026-09-07T10:00:00.000Z");
        const dispatched: string[] = [];
        const sender: DeliverySender = async (delivery) => {
            dispatched.push(delivery.id);
            return { outcome: "accepted", providerId: `provider-${delivery.id}` };
        };

        try {
            const scopedWorkerDbA = createScopedWorkerDb(workerDbA, fixture.deliveryIds);
            const scopedWorkerDbB = createScopedWorkerDb(workerDbB, fixture.deliveryIds);
            await Promise.all([
                processCommunicationsRun(scopedWorkerDbA, sender, { now, batchSize: 2 }),
                processCommunicationsRun(scopedWorkerDbB, sender, { now, batchSize: 2 }),
            ]);
            expect(dispatched.filter((id) => fixture.deliveryIds.includes(id))).toHaveLength(3);
            expect(new Set(dispatched.filter((id) => fixture.deliveryIds.includes(id))).size).toBe(3);
            const stored = await db.delivery.findMany({ where: { id: { in: fixture.deliveryIds } } });
            expect(stored).toHaveLength(3);
            expect(stored.every((delivery) => delivery.state === "ACCEPTED" && delivery.attempts === 1)).toBe(true);
        } finally {
            await cleanup(fixture);
        }
    });

    it("stale lease recovers", async () => {
        const fixture = await seedFixture([
            {
                channel: "email",
                destinationKey: "stale@example.test",
                state: "SENDING",
                attempts: 1,
                leaseUntil: new Date("2026-09-07T09:59:00.000Z"),
            },
        ]);
        const now = new Date("2026-09-07T10:00:00.000Z");

        try {
            const report = await processCommunicationsRun(
                createScopedWorkerDb(db, fixture.deliveryIds),
                acceptedSender,
                { now },
            );
            const stored = await db.delivery.findUniqueOrThrow({ where: { id: fixture.deliveryIds[0] } });
            expect(report).toMatchObject({ requeued: 1, claimed: 1, accepted: 1 });
            expect(stored.state).toBe("ACCEPTED");
            expect(stored.attempts).toBe(2);
        } finally {
            await cleanup(fixture);
        }
    });

    it("permanent failure not retried", async () => {
        const fixture = await seedFixture([{ channel: "email", destinationKey: "permanent@example.test" }]);
        const now = new Date("2026-09-07T10:00:00.000Z");
        let secondSenderCalls = 0;
        const permanentFailure: DeliverySender = async () => ({
            outcome: "failed",
            message: "invalid destination",
            retryable: false,
        });
        const acceptingSender: DeliverySender = async () => {
            secondSenderCalls++;
            return { outcome: "accepted", providerId: "must-not-send" };
        };

        try {
            const first = await processCommunicationsRun(
                createScopedWorkerDb(db, fixture.deliveryIds),
                permanentFailure,
                { now },
            );
            const failed = await db.delivery.findUniqueOrThrow({ where: { id: fixture.deliveryIds[0] } });
            expect(first).toMatchObject({ claimed: 1, failed: 1 });
            expect(failed.state).toBe("FAILED");
            expect(failed.nextAttemptAt).toBeNull();
            expect(failed.attempts).toBe(1);

            const secondNow = new Date(now.getTime() + 60_000);
            const second = await processCommunicationsRun(
                createScopedWorkerDb(db, fixture.deliveryIds),
                acceptingSender,
                { now: secondNow },
            );
            expect(second.claimed).toBe(0);
            expect(second.failed).toBe(0);
            expect(secondSenderCalls).toBe(0);
        } finally {
            await cleanup(fixture);
        }
    });

    it("successful in app delivery does not suppress email retry", async () => {
        const fixture = await seedFixture([
            { channel: "in_app", destinationKey: "in-app-user" },
            { channel: "email", destinationKey: "retry@example.test" },
        ]);
        const now = new Date("2026-09-07T10:00:00.000Z");
        const firstSender: DeliverySender = async (delivery) => delivery.channel === "in_app"
            ? { outcome: "accepted", providerId: "in-app-provider" }
            : { outcome: "failed", message: "temporary provider outage", retryable: true };

        try {
            const first = await processCommunicationsRun(
                createScopedWorkerDb(db, fixture.deliveryIds),
                firstSender,
                { now },
            );
            const afterFirst = await db.delivery.findMany({ where: { id: { in: fixture.deliveryIds } } });
            const inApp = afterFirst.find((delivery) => delivery.channel === "in_app");
            const email = afterFirst.find((delivery) => delivery.channel === "email");
            expect(first).toMatchObject({ claimed: 2, accepted: 1, failed: 0 });
            expect(inApp?.state).toBe("ACCEPTED");
            expect(email?.state).toBe("PENDING");
            expect(email?.nextAttemptAt && email.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());

            const secondNow = new Date(now.getTime() + 2 * 60_000);
            const second = await processCommunicationsRun(
                createScopedWorkerDb(db, fixture.deliveryIds),
                acceptedSender,
                { now: secondNow },
            );
            const finalEmail = await db.delivery.findUniqueOrThrow({ where: { id: email?.id } });
            expect(second).toMatchObject({ claimed: 1, accepted: 1 });
            expect(finalEmail.state).toBe("ACCEPTED");
            expect(finalEmail.attempts).toBe(2);
        } finally {
            await cleanup(fixture);
        }
    });
});
