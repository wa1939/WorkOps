import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../../scripts/assert-local-database";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

import { GET, POST } from "./route";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Communications admin tests require a database name ending with _test");
    }
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();

beforeAll(() => {
    if (databaseEnabled) {
        const parsed = assertLocalDatabaseUrl(process.env.DATABASE_URL ?? "");
        if (!parsed.pathname.endsWith("_test")) {
            throw new Error("Communications admin tests require a database name ending with _test");
        }
    }
});

afterAll(async () => {
    await db.$disconnect();
});

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNICATION_INTERNAL_DOMAINS", "example.test");
});

describe("GET /api/admin/communications", () => {
    it("requires authentication", async () => {
        mocks.auth.mockResolvedValue(null);

        const response = await GET(new Request("https://app.example/api/admin/communications?view=log"));

        expect(response.status).toBe(401);
    });

    it("rejects a non-admin workspace member", async () => {
        mocks.auth.mockResolvedValue({ user: { id: "member-1", role: "MEMBER", email: "member@example.test" } });

        const response = await GET(new Request("https://app.example/api/admin/communications?view=log"));

        expect(response.status).toBe(403);
    });
});

describe.runIf(databaseEnabled)("communications admin persistence", () => {
    it("workspace admin cannot inspect other recipients and log destinations are redacted", async () => {
        const suffix = randomUUID();
        const userId = `c08-redaction-user-${suffix}`;
        const eventId = `c08-redaction-event-${suffix}`;
        const deliveryId = `c08-redaction-delivery-${suffix}`;
        mocks.auth.mockResolvedValue({ user: { id: `admin-${suffix}`, role: "ADMIN", email: `admin-${suffix}@example.test` } });

        await db.notificationEvent.create({
            data: {
                id: eventId,
                workspaceId: `c08-redaction-workspace-${suffix}`,
                sourceType: "c08-route-test",
                sourceId: `source-${suffix}`,
                sourceVersion: "v1",
                category: "task",
                recipientUserId: userId,
                dedupeKey: `c08-redaction-dedupe-${suffix}`,
            },
        });
        await db.delivery.create({
            data: {
                id: deliveryId,
                eventId,
                channel: "email",
                destinationKey: `person-${suffix}@example.test`,
                state: "FAILED",
                attempts: 2,
                providerId: "provider-c08",
                lastError: `provider response Bearer abc.token password=hidden ${"x".repeat(260)}`,
            },
        });

        try {
            const response = await GET(new Request(`https://app.example/api/admin/communications?view=log&userId=${encodeURIComponent(userId)}`));
            const body = await response.json();
            const row = body.rows.find((candidate: { id: string }) => candidate.id === deliveryId);

            expect(response.status).toBe(200);
            expect(row).toMatchObject({
                id: deliveryId,
                destinationKey: "***@example.test",
                state: "FAILED",
                attempts: 2,
            });
            expect(row.lastError).not.toMatch(/abc\.token|password|bearer|hidden/i);
            expect(row.lastError.length).toBeLessThanOrEqual(200);
            expect(JSON.stringify(body)).not.toContain(`person-${suffix}@example.test`);
        } finally {
            await db.delivery.delete({ where: { id: deliveryId } });
            await db.notificationEvent.delete({ where: { id: eventId } });
        }
    });

    it("forces test-send delivery to the authenticated admin email", async () => {
        const suffix = randomUUID();
        const adminId = `c08-test-send-admin-${suffix}`;
        const adminEmail = `admin-${suffix}@example.test`;
        mocks.auth.mockResolvedValue({ user: { id: adminId, role: "ADMIN", email: adminEmail } });

        const response = await POST(
            new NextRequest("https://app.example/api/admin/communications", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    action: "test-send",
                    channel: "email",
                    category: "task",
                    destination: "attacker@example.test",
                }),
            }),
        );
        const body = await response.json();
        const events = await db.notificationEvent.findMany({
            where: { recipientUserId: adminId, sourceType: "admin_test_send" },
            include: { deliveries: true },
        });

        try {
            expect(response.status).toBe(200);
            expect(body.id).toBeTruthy();
            expect(events).toHaveLength(1);
            expect(events[0].dedupeKey).toMatch(new RegExp(`^test-send:${adminId}:`));
            expect(events[0].deliveries).toHaveLength(1);
            expect(events[0].deliveries[0]).toMatchObject({
                id: body.id,
                channel: "email",
                destinationKey: adminEmail,
                state: "PENDING",
            });
            expect(events[0].deliveries[0].destinationKey).not.toBe("attacker@example.test");
        } finally {
            for (const event of events) {
                await db.delivery.deleteMany({ where: { eventId: event.id } });
                await db.notificationEvent.delete({ where: { id: event.id } });
            }
        }
    });
});
