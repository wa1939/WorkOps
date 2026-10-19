import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../../scripts/assert-local-database";
import { createScopedWorkerDb } from "@/lib/communications/test-support/scoped-worker-db";
import type { DeliverySender } from "@/lib/communications/worker";
import { POST } from "./handler";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Communications cron tests require a database name ending with _test");
    }
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();

type Fixture = {
    userId: string;
    eventId: string;
    deliveryIds: string[];
};

async function seedBatch(): Promise<Fixture> {
    const suffix = randomUUID();
    const userId = `c03-route-user-${suffix}`;
    const eventId = `c03-route-event-${suffix}`;
    const deliveryIds = [`c03-route-delivery-${randomUUID()}`, `c03-route-delivery-${randomUUID()}`];
    await db.user.create({
        data: {
            id: userId,
            email: `${userId}@example.test`,
            name: "C03 route fixture",
        },
    });
    await db.notificationEvent.create({
        data: {
            id: eventId,
            workspaceId: `c03-route-workspace-${suffix}`,
            sourceType: "c03-route-test",
            sourceId: `source-${suffix}`,
            sourceVersion: "v1",
            category: "task",
            recipientUserId: userId,
            dedupeKey: `c03-route-dedupe-${suffix}`,
        },
    });
    await db.delivery.createMany({
        data: deliveryIds.map((id, index) => ({
            id,
            eventId,
            channel: index === 0 ? "in_app" : "email",
            destinationKey: index === 0 ? "route-user" : "route@example.test",
            state: "PENDING" as const,
        })),
    });
    return { userId, eventId, deliveryIds };
}

async function seedUnrelatedPending(): Promise<Fixture> {
    const suffix = randomUUID();
    const userId = `c03-route-unrelated-user-${suffix}`;
    const eventId = `c03-route-unrelated-event-${suffix}`;
    const deliveryId = `c03-route-unrelated-delivery-${suffix}`;
    const createdAt = new Date("2020-01-01T00:00:00.000Z");
    await db.user.create({
        data: {
            id: userId,
            email: `${userId}@example.test`,
            name: "C03 unrelated route probe",
        },
    });
    await db.notificationEvent.create({
        data: {
            id: eventId,
            workspaceId: `c03-route-unrelated-workspace-${suffix}`,
            sourceType: "c03-route-unrelated-test",
            sourceId: `source-${suffix}`,
            sourceVersion: "v1",
            category: "task",
            recipientUserId: userId,
            dedupeKey: `c03-route-unrelated-dedupe-${suffix}`,
            createdAt,
        },
    });
    await db.delivery.create({
        data: {
            id: deliveryId,
            eventId,
            channel: "email",
            destinationKey: "route-unrelated@example.test",
            state: "PENDING",
            createdAt,
        },
    });
    return { userId, eventId, deliveryIds: [deliveryId] };
}

async function cleanup(fixture: Fixture): Promise<void> {
    await db.delivery.deleteMany({ where: { id: { in: fixture.deliveryIds } } });
    await db.notificationEvent.deleteMany({ where: { id: fixture.eventId } });
    await db.user.deleteMany({ where: { id: fixture.userId } });
}

afterEach(() => {
    delete process.env.CRON_SECRET;
});

afterAll(async () => {
    await db.$disconnect();
});

describe.runIf(databaseEnabled)("communications cron route", () => {
    it("rejects invalid scheduler secret", async () => {
        let senderCalls = 0;
        const sender: DeliverySender = async () => {
            senderCalls++;
            return { outcome: "accepted", providerId: "must-not-send" };
        };
        delete process.env.CRON_SECRET;
        const missing = await POST(
            new NextRequest("http://localhost/api/cron/communications", { method: "POST" }),
            { db, sender },
        );
        process.env.CRON_SECRET = "expected-secret";
        const wrong = await POST(
            new NextRequest("http://localhost/api/cron/communications", {
                method: "POST",
                headers: { "x-cron-secret": "wrong-secret" },
                body: JSON.stringify({ batchSize: 2 }),
            }),
            { db, sender },
        );

        expect(missing.status).toBe(401);
        expect(wrong.status).toBe(401);
        expect(senderCalls).toBe(0);
    });

    it("runs bounded batch with valid secret", async () => {
        const unrelated = await seedUnrelatedPending();
        const fixture = await seedBatch();
        const dispatched: string[] = [];
        const sender: DeliverySender = async (delivery) => {
            dispatched.push(delivery.id);
            return { outcome: "accepted", providerId: `route-provider-${delivery.id}` };
        };
        const now = new Date("2026-09-07T10:00:00.000Z");
        const unrelatedBefore = await db.delivery.findUniqueOrThrow({ where: { id: unrelated.deliveryIds[0] } });
        process.env.CRON_SECRET = "expected-secret";

        try {
            const response = await POST(
                new NextRequest("http://localhost/api/cron/communications", {
                    method: "POST",
                    headers: {
                        "x-cron-secret": "expected-secret",
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({ batchSize: 2 }),
                }),
                { db: createScopedWorkerDb(db, fixture.deliveryIds), sender, now },
            );
            const body = await response.json();
            const stored = await db.delivery.findMany({ where: { id: { in: fixture.deliveryIds } } });
            const unrelatedAfter = await db.delivery.findUniqueOrThrow({ where: { id: unrelated.deliveryIds[0] } });

            expect(response.status).toBe(200);
            expect(body).toMatchObject({ claimed: 2, accepted: 2, failed: 0, suppressed: 0, unknown: 0 });
            expect(dispatched).toHaveLength(2);
            expect(new Set(dispatched)).toEqual(new Set(fixture.deliveryIds));
            expect(stored.every((delivery) => delivery.state === "ACCEPTED" && delivery.attempts === 1)).toBe(true);
            expect(unrelatedAfter).toEqual(unrelatedBefore);
        } finally {
            await cleanup(fixture);
            await cleanup(unrelated);
        }
    });
});
