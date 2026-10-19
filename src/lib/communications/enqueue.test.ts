import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl } from "../../../scripts/assert-local-database";
import { enqueueEvent, enqueueWithDomainWork, type EnqueueEventInput } from "./enqueue";

const db = new PrismaClient();
const workspaceId = `workspace-c02-${randomUUID()}`;
const recipientUserId = `recipient-c02-${randomUUID()}`;
let safeDatabase = false;

beforeAll(() => {
    const url = assertLocalDatabaseUrl(process.env.DATABASE_URL ?? "");
    if (!url.pathname.endsWith("_test")) {
        throw new Error("Communications persistence tests require a database name ending with _test");
    }
    safeDatabase = true;
});

afterAll(async () => {
    await db.$disconnect();
});

function eventInput(overrides: Partial<EnqueueEventInput> = {}): EnqueueEventInput {
    return {
        workspaceId,
        sourceType: "test",
        sourceId: `source-${randomUUID()}`,
        sourceVersion: "v1",
        category: "task",
        recipientUserId,
        dedupeKey: `c02-${randomUUID()}`,
        deliveries: [{ channel: "email", destinationKey: "recipient@example.test" }],
        ...overrides,
    };
}

async function cleanup(dedupeKey: string): Promise<void> {
    if (!safeDatabase) return;
    await db.delivery.deleteMany({ where: { event: { dedupeKey } } });
    await db.notificationEvent.deleteMany({ where: { dedupeKey } });
}

describe("transactional notification enqueue", () => {
    it("domain rollback leaves no notification", async () => {
        const input = eventInput();

        try {
            await expect(
                enqueueWithDomainWork(db, async () => {
                    throw new Error("synthetic domain failure");
                }, input),
            ).rejects.toThrow("synthetic domain failure");
            await expect(db.notificationEvent.count({ where: { dedupeKey: input.dedupeKey } })).resolves.toBe(0);
        } finally {
            await cleanup(input.dedupeKey);
        }
    });

    it("same source version enqueues once", async () => {
        const input = eventInput();

        try {
            await expect(enqueueEvent(db, input)).resolves.toMatchObject({ created: true });
            await expect(enqueueEvent(db, input)).resolves.toMatchObject({ created: false });
            await expect(db.notificationEvent.count({ where: { dedupeKey: input.dedupeKey } })).resolves.toBe(1);
        } finally {
            await cleanup(input.dedupeKey);
        }
    });

    it("suppressed channel creates no delivery row", async () => {
        const input = eventInput({
            category: "task",
            deliveries: [{ channel: "push", destinationKey: "push-recipient-c02" }],
        });

        try {
            await enqueueEvent(db, input);
            const stored = await db.notificationEvent.findUnique({
                where: { dedupeKey: input.dedupeKey },
                include: { deliveries: true },
            });
            expect(stored).not.toBeNull();
            expect(stored?.deliveries).toHaveLength(0);
        } finally {
            await cleanup(input.dedupeKey);
        }
    });
});
