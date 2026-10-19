import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../../../scripts/assert-local-database";

const mocks = vi.hoisted(() => {
    process.env.PWA_SUBSCRIPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
    return { auth: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

import { DELETE, POST } from "./route";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Push subscription tests require a database name ending with _test");
    }
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();

afterAll(async () => {
    await db.$disconnect();
});

const endpointHash = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");
const request = (method: "POST" | "DELETE", body: unknown) => new Request("https://app.example/api/notifications/push/subscriptions", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
});

async function createUsers(suffix: string) {
    const userOne = `p04-user-one-${suffix}`;
    const userTwo = `p04-user-two-${suffix}`;
    await db.user.createMany({
        data: [
            { id: userOne, email: `${userOne}@example.test`, name: "P04 user one", role: "MEMBER" },
            { id: userTwo, email: `${userTwo}@example.test`, name: "P04 user two", role: "MEMBER" },
        ],
    });
    return { userOne, userTwo };
}

async function cleanupUsers(userOne: string, userTwo: string, endpoint: string) {
    await db.pushSubscription.deleteMany({ where: { endpointHash: endpointHash(endpoint) } });
    await db.user.deleteMany({ where: { id: { in: [userOne, userTwo] } } });
}

describe.runIf(databaseEnabled)("push subscription routes", () => {
    beforeEach(() => vi.clearAllMocks());

    it("cannot register subscription for another user", async () => {
        const suffix = randomUUID();
        const endpoint = `https://fcm.googleapis.com/fcm/send/${suffix}`;
        const { userOne, userTwo } = await createUsers(suffix);
        try {
            mocks.auth.mockResolvedValue({ user: { id: userOne, role: "MEMBER" } });
            const response = await POST(request("POST", {
                userId: userTwo,
                installationId: `installation-${suffix}`,
                endpoint,
                keys: { p256dh: `p256dh-${suffix}`, auth: `auth-${suffix}` },
            }));

            expect(response.status).toBe(201);
            const row = await db.pushSubscription.findUnique({ where: { endpointHash: endpointHash(endpoint) } });
            expect(row).toMatchObject({ userId: userOne, enabled: true, revokedAt: null });
            expect(row?.endpointEncrypted).not.toContain(endpoint);
            expect(row?.p256dhEncrypted).not.toContain(`p256dh-${suffix}`);
            expect(row?.authEncrypted).not.toContain(`auth-${suffix}`);

            mocks.auth.mockResolvedValue({ user: { id: userTwo, role: "MEMBER" } });
            const deleteResponse = await DELETE(request("DELETE", { endpoint }));
            expect(deleteResponse.status).toBe(404);

            await expect(db.pushSubscription.findUnique({ where: { endpointHash: endpointHash(endpoint) } })).resolves.toMatchObject({
                userId: userOne,
                enabled: true,
                revokedAt: null,
            });
        } finally {
            await cleanupUsers(userOne, userTwo, endpoint);
        }
    });

    it("duplicate endpoint cannot silently change owner", async () => {
        const suffix = randomUUID();
        const endpoint = `https://updates.push.services.mozilla.com/wpush/v2/${suffix}`;
        const { userOne, userTwo } = await createUsers(suffix);
        try {
            mocks.auth.mockResolvedValue({ user: { id: userOne, role: "MEMBER" } });
            const firstResponse = await POST(request("POST", {
                endpoint,
                keys: { p256dh: `first-p256dh-${suffix}`, auth: `first-auth-${suffix}` },
            }));
            expect(firstResponse.status).toBe(201);

            mocks.auth.mockResolvedValue({ user: { id: userTwo, role: "MEMBER" } });
            const secondResponse = await POST(request("POST", {
                endpoint,
                keys: { p256dh: `second-p256dh-${suffix}`, auth: `second-auth-${suffix}` },
            }));
            expect(secondResponse.status).toBe(409);

            await expect(db.pushSubscription.findUnique({ where: { endpointHash: endpointHash(endpoint) } })).resolves.toMatchObject({
                userId: userOne,
                enabled: true,
            });
        } finally {
            await cleanupUsers(userOne, userTwo, endpoint);
        }
    });

    it("private network endpoint rejected", async () => {
        const endpoint = `http://localhost/push/${randomUUID()}`;
        mocks.auth.mockResolvedValue({ user: { id: `p04-private-${randomUUID()}`, role: "MEMBER" } });

        const response = await POST(request("POST", {
            endpoint,
            keys: { p256dh: "private-p256dh", auth: "private-auth" },
        }));

        expect(response.status).toBe(400);
        await expect(db.pushSubscription.count({ where: { endpointHash: endpointHash(endpoint) } })).resolves.toBe(0);
    });
});
