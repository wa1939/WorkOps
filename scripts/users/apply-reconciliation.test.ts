import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../assert-local-database";
import {
    applyManifest,
    computeInventoryChecksum,
    loadCurrentState,
    type ReconciliationManifest,
    type UserInventoryState,
} from "./apply-reconciliation";

const databaseUrl = readDatabaseUrl();
const databaseEnabled = Boolean(databaseUrl);
if (databaseEnabled) {
    assertLocalDatabaseUrl(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
}

type Fixture = {
    sourceOne: string;
    sourceTwo: string;
    canonicalOne: string;
    canonicalTwo: string;
    approver: string;
    userIds: string[];
};

async function createFixture(db: PrismaClient): Promise<Fixture> {
    const suffix = randomUUID();
    const ids = {
        sourceOne: `i03-source-one-${suffix}`,
        sourceTwo: `i03-source-two-${suffix}`,
        canonicalOne: `i03-canonical-one-${suffix}`,
        canonicalTwo: `i03-canonical-two-${suffix}`,
        approver: `i03-approver-${suffix}`,
    };
    const users = [
        [ids.sourceOne, "Source One"],
        [ids.sourceTwo, "Source Two"],
        [ids.canonicalOne, "Canonical One"],
        [ids.canonicalTwo, "Canonical Two"],
        [ids.approver, "Approver"],
    ] as const;

    await db.user.createMany({
        data: users.map(([id, name]) => ({
            id,
            email: `${id}@example.test`,
            name,
            role: "MEMBER" as const,
            isActive: true,
        })),
    });

    return { ...ids, userIds: users.map(([id]) => id) };
}

async function cleanupFixture(db: PrismaClient, fixture: Fixture): Promise<void> {
    await db.userIdentityAlias.deleteMany({
        where: {
            OR: [
                { sourceUserId: { in: fixture.userIds } },
                { canonicalUserId: { in: fixture.userIds } },
                { approvedById: { in: fixture.userIds } },
            ],
        },
    });
    await db.user.deleteMany({ where: { id: { in: fixture.userIds } } });
}

async function withFixture(testBody: (db: PrismaClient, fixture: Fixture) => Promise<void>): Promise<void> {
    const db = new PrismaClient();
    let fixture: Fixture | undefined;
    try {
        fixture = await createFixture(db);
        await testBody(db, fixture);
    } finally {
        if (fixture) await cleanupFixture(db, fixture);
        await db.$disconnect();
    }
}

async function signedManifest(
    db: PrismaClient,
    sourceUserIds: string[],
    mappings: ReconciliationManifest["mappings"],
): Promise<{ manifest: ReconciliationManifest; currentState: UserInventoryState[]; checksum: string }> {
    const currentState = await loadCurrentState(db, sourceUserIds);
    const checksum = computeInventoryChecksum(currentState);
    return {
        manifest: {
            inventoryChecksum: checksum,
            mappings,
            idempotencyKey: `i03-manifest-${randomUUID()}`,
        },
        currentState,
        checksum,
    };
}

function mapping(sourceUserId: string, canonicalUserId: string, approvedById: string, reason: string) {
    return { sourceUserId, canonicalUserId, approvedById, reason };
}

describe.runIf(databaseEnabled)("apply-reconciliation", () => {
    it("rejects changed inventory", async () => {
        await withFixture(async (db, fixture) => {
            const signed = await signedManifest(
                db,
                [fixture.sourceOne],
                [mapping(fixture.sourceOne, fixture.canonicalOne, fixture.approver, "Reviewed source identity")],
            );
            await db.user.update({ where: { id: fixture.sourceOne }, data: { name: "Changed after approval" } });

            await expect(applyManifest(db, signed.manifest, {
                apply: true,
                expectedChecksum: signed.checksum,
                currentState: signed.currentState,
            })).rejects.toThrow(/checksum/i);
            expect(await db.userIdentityAlias.count({ where: { sourceUserId: fixture.sourceOne } })).toBe(0);
        });
    });

    it("repeat application is no op", async () => {
        await withFixture(async (db, fixture) => {
            const signed = await signedManifest(
                db,
                [fixture.sourceOne],
                [mapping(fixture.sourceOne, fixture.canonicalOne, fixture.approver, "Reviewed source identity")],
            );

            const first = await applyManifest(db, signed.manifest, {
                apply: true,
                expectedChecksum: signed.checksum,
                currentState: signed.currentState,
            });
            const firstCount = await db.userIdentityAlias.count({ where: { sourceUserId: fixture.sourceOne } });
            const second = await applyManifest(db, signed.manifest, {
                apply: true,
                expectedChecksum: signed.checksum,
                currentState: signed.currentState,
            });
            const secondCount = await db.userIdentityAlias.count({ where: { sourceUserId: fixture.sourceOne } });

            expect(first.status).toBe("applied");
            expect(first.created).toBe(1);
            expect(second.status).toBe("no-op");
            expect(second.created).toBe(0);
            expect(firstCount).toBe(1);
            expect(secondCount).toBe(firstCount);
        });
    });

    it("rollback restores operational links", async () => {
        await withFixture(async (db, fixture) => {
            const missingCanonical = `i03-missing-canonical-${randomUUID()}`;
            const signed = await signedManifest(
                db,
                [fixture.sourceOne, fixture.sourceTwo],
                [
                    mapping(fixture.sourceOne, fixture.canonicalOne, fixture.approver, "Reviewed first identity"),
                    mapping(fixture.sourceTwo, missingCanonical, fixture.approver, "Reviewed second identity"),
                ],
            );

            await expect(applyManifest(db, signed.manifest, {
                apply: true,
                expectedChecksum: signed.checksum,
                currentState: signed.currentState,
            })).rejects.toThrow(/exist|active/i);
            expect(await db.userIdentityAlias.count({ where: { sourceUserId: fixture.sourceOne } })).toBe(0);
            expect(await db.userIdentityAlias.count({ where: { sourceUserId: fixture.sourceTwo } })).toBe(0);
        });
    });

    it("unapproved mapping writes nothing", async () => {
        await withFixture(async (db, fixture) => {
            const signed = await signedManifest(
                db,
                [fixture.sourceOne],
                [mapping(fixture.sourceOne, fixture.canonicalOne, fixture.approver, "Reviewed source identity")],
            );

            const result = await applyManifest(db, signed.manifest, {
                apply: false,
                expectedChecksum: signed.checksum,
                currentState: signed.currentState,
            });

            expect(result.status).toBe("dry-run");
            expect(result.created).toBe(0);
            expect(await db.userIdentityAlias.count({ where: { sourceUserId: fixture.sourceOne } })).toBe(0);
        });
    });
});
