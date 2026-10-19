import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../../scripts/assert-local-database";
import { POST } from "./handler";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Communications webhook tests require a database name ending with _test");
    }
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();
const webhookSecret = Buffer.from("c04-webhook-test-secret", "utf8").toString("base64");
const fixedNow = new Date("2026-09-07T10:00:00.000Z");

process.env.WEBHOOK_SECRET = webhookSecret;

type Fixture = {
    userId: string;
    eventId: string;
    deliveryId: string;
};

async function seedDelivery(state: "ACCEPTED" | "BOUNCED"): Promise<Fixture> {
    const suffix = randomUUID();
    const userId = `c04-webhook-user-${suffix}`;
    const eventId = `c04-webhook-event-${suffix}`;
    const deliveryId = `c04-webhook-delivery-${suffix}`;
    const providerId = `c04-provider-${suffix}`;

    await db.user.create({
        data: {
            id: userId,
            email: `${userId}@example.test`,
            name: "C04 webhook fixture",
        },
    });
    await db.notificationEvent.create({
        data: {
            id: eventId,
            workspaceId: `c04-webhook-workspace-${suffix}`,
            sourceType: "c04-webhook-test",
            sourceId: `source-${suffix}`,
            sourceVersion: "v1",
            category: "task",
            recipientUserId: userId,
            dedupeKey: `c04-webhook-dedupe-${suffix}`,
        },
    });
    await db.delivery.create({
        data: {
            id: deliveryId,
            eventId,
            channel: "email",
            destinationKey: `${userId}@example.test`,
            providerId,
            state,
            acceptedAt: state === "ACCEPTED" ? fixedNow : null,
            deliveredAt: null,
        },
    });
    return { userId, eventId, deliveryId };
}

async function cleanup(fixture: Fixture): Promise<void> {
    await db.delivery.deleteMany({ where: { id: fixture.deliveryId } });
    await db.notificationEvent.deleteMany({ where: { id: fixture.eventId } });
    await db.user.deleteMany({ where: { id: fixture.userId } });
}

function makeRequest(type: string, providerId: string, signature = true): NextRequest {
    const payload = JSON.stringify({ type, data: { email_id: providerId } });
    const svixId = `msg-${providerId}`;
    const timestamp = Math.floor(fixedNow.getTime() / 1000).toString();
    const signedContent = `${svixId}.${timestamp}.${payload}`;
    const digest = createHmac("sha256", Buffer.from(webhookSecret, "base64"))
        .update(signedContent)
        .digest("base64");

    return new NextRequest("http://localhost/api/webhooks/email", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "svix-id": svixId,
            "svix-timestamp": timestamp,
            "svix-signature": signature ? `v1,${digest}` : "v1,forged-signature",
        },
        body: payload,
    });
}

afterAll(async () => {
    delete process.env.WEBHOOK_SECRET;
    await db.$disconnect();
});

describe.runIf(databaseEnabled)("email webhook route", () => {
    it("forged webhook writes nothing", async () => {
        const fixture = await seedDelivery("ACCEPTED");
        try {
            const before = await db.delivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });
            const response = await POST(makeRequest("email.delivered", before.providerId!, false), { db, now: fixedNow });
            const after = await db.delivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });

            expect(response.status).toBe(401);
            expect(after).toEqual(before);
        } finally {
            await cleanup(fixture);
        }
    });

    it("duplicate webhook is idempotent", async () => {
        const fixture = await seedDelivery("ACCEPTED");
        try {
            const seeded = await db.delivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });
            const first = await POST(makeRequest("email.delivered", seeded.providerId!), { db, now: fixedNow });
            const afterFirst = await db.delivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });
            const second = await POST(makeRequest("email.delivered", seeded.providerId!), { db, now: fixedNow });
            const afterSecond = await db.delivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });

            expect(first.status).toBe(200);
            await expect(first.json()).resolves.toEqual({ applied: true });
            expect(afterFirst.state).toBe("DELIVERED");
            expect(afterFirst.deliveredAt).not.toBeNull();
            expect(second.status).toBe(200);
            await expect(second.json()).resolves.toEqual({ applied: false });
            expect(afterSecond.state).toBe("DELIVERED");
            expect(afterSecond.deliveredAt?.getTime()).toBe(afterFirst.deliveredAt?.getTime());
        } finally {
            await cleanup(fixture);
        }
    });

    it("bounce is not delivery", async () => {
        const fixture = await seedDelivery("ACCEPTED");
        try {
            const seeded = await db.delivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });
            const response = await POST(makeRequest("email.bounced", seeded.providerId!), { db, now: fixedNow });
            const stored = await db.delivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ applied: true });
            expect(stored.state).toBe("BOUNCED");
            expect(stored.deliveredAt).toBeNull();
        } finally {
            await cleanup(fixture);
        }
    });

    it("late webhook cannot downgrade terminal state", async () => {
        const fixture = await seedDelivery("BOUNCED");
        try {
            const seeded = await db.delivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });
            const response = await POST(makeRequest("email.delivered", seeded.providerId!), { db, now: fixedNow });
            const stored = await db.delivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ applied: false });
            expect(stored.state).toBe("BOUNCED");
            expect(stored.deliveredAt).toBeNull();
        } finally {
            await cleanup(fixture);
        }
    });
});
