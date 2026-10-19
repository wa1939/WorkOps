import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";
import {
    ReconciliationError,
    applyMapping,
    auditActorOf,
    canonicalizeMemberships,
    requestCanonicalMapping,
} from "./reconciliation";

const databaseUrl = readDatabaseUrl();
assertLocalDatabaseUrl(databaseUrl);
process.env.DATABASE_URL = databaseUrl;

describe("identity reconciliation", () => {
    it("does not infer identity from name", async () => {
        const db = new PrismaClient();
        const sourceUserId = `identity-name-${randomUUID()}`;
        try {
            const before = await db.userIdentityAlias.count({ where: { sourceUserId } });
            expect(() => requestCanonicalMapping(
                { sourceUserId, reason: "Name-only proposal must be rejected" },
                { sourceName: "Source Person", canonicalName: "Canonical Person" },
            )).toThrow(TypeError);
            const after = await db.userIdentityAlias.count({ where: { sourceUserId } });
            expect(after).toBe(before);
        } finally {
            await db.userIdentityAlias.deleteMany({ where: { sourceUserId } });
            await db.$disconnect();
        }
    });

    it("rejects cyclic alias", async () => {
        const db = new PrismaClient();
        const suffix = randomUUID();
        const ids = {
            source: `identity-source-${suffix}`,
            canonical: `identity-canonical-${suffix}`,
            approver: `identity-approver-${suffix}`,
        };
        try {
            await db.user.createMany({
                data: [
                    { id: ids.source, email: `${ids.source}@example.test`, name: "Source", isActive: true },
                    { id: ids.canonical, email: `${ids.canonical}@example.test`, name: "Canonical", isActive: true },
                    { id: ids.approver, email: `${ids.approver}@example.test`, name: "Approver", isActive: true },
                ],
            });

            await applyMapping(db, requestCanonicalMapping({
                sourceUserId: ids.source,
                canonicalUserId: ids.canonical,
                approvedById: ids.approver,
                reason: "Approved source-to-canonical mapping",
            }));

            await expect(applyMapping(db, requestCanonicalMapping({
                sourceUserId: ids.canonical,
                canonicalUserId: ids.source,
                approvedById: ids.approver,
                reason: "Would create a cycle",
            }))).rejects.toThrow(new ReconciliationError("cyclic alias"));

            await expect(applyMapping(db, requestCanonicalMapping({
                sourceUserId: ids.source,
                canonicalUserId: ids.source,
                approvedById: ids.approver,
                reason: "Self alias is not allowed",
            }))).rejects.toThrow(new ReconciliationError("cyclic alias"));

            const rows = await db.userIdentityAlias.findMany({
                where: { sourceUserId: { in: [ids.source, ids.canonical] } },
                select: { sourceUserId: true, canonicalUserId: true },
            });
            expect(rows).toEqual([{ sourceUserId: ids.source, canonicalUserId: ids.canonical }]);
        } finally {
            await db.userIdentityAlias.deleteMany({
                where: {
                    OR: [
                        { sourceUserId: { in: Object.values(ids) } },
                        { canonicalUserId: { in: Object.values(ids) } },
                        { approvedById: { in: Object.values(ids) } },
                    ],
                },
            });
            await db.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
            await db.$disconnect();
        }
    });

    it("deduplicates identical task membership", () => {
        const memberships = canonicalizeMemberships(
            [[
                { taskId: "t1", userId: "src1" },
                { taskId: "t1", userId: "src2" },
                { taskId: "t2", userId: "src1" },
            ]],
            (userId) => userId === "src1" || userId === "src2" ? "canon" : userId,
        );

        expect(memberships).toEqual([
            { taskId: "t1", userId: "canon" },
            { taskId: "t2", userId: "canon" },
        ]);
    });

    it("preserves original audit actor", () => {
        expect(auditActorOf("src1", new Map([["src1", "canon"]]))).toBe("src1");
    });
});
