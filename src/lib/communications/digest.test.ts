import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl } from "../../../scripts/assert-local-database";
import {
    buildDigestPreview,
    parseAndValidateRecipients,
    saveDigestDraft,
    sendApprovedDigest,
    type DigestEmailSender,
    type DigestPreview,
} from "./digest";

const db = new PrismaClient();
const fixedPeriod = {
    weekStart: new Date("2026-08-30T00:00:00.000Z"),
    weekEnd: new Date("2026-09-06T00:00:00.000Z"),
};
const actorScopes = {
    id: `c07-actor-${randomUUID()}`,
    role: "ADMIN" as const,
    departmentIds: [] as string[],
};
let safeDatabase = false;

beforeAll(() => {
    const url = assertLocalDatabaseUrl(process.env.DATABASE_URL ?? "");
    if (!url.pathname.endsWith("_test")) {
        throw new Error("Digest persistence tests require a database name ending with _test");
    }
    safeDatabase = true;
});

afterAll(async () => {
    await db.$disconnect();
});

async function makeDraft(): Promise<{ preview: DigestPreview; draftId: string }> {
    const preview = await buildDigestPreview(db, { ...fixedPeriod, actorScopes });
    const draft = await saveDigestDraft(db, preview);
    return { preview, draftId: draft.id };
}

async function setRecipients(value: string): Promise<{ hadExisting: boolean; existingValue?: string }> {
    const existing = await db.appConfig.findUnique({ where: { key: "SUNDAY_DIGEST_TO" } });
    await db.appConfig.upsert({
        where: { key: "SUNDAY_DIGEST_TO" },
        update: { value },
        create: { key: "SUNDAY_DIGEST_TO", value },
    });
    return { hadExisting: Boolean(existing), existingValue: existing?.value };
}

async function restoreRecipients(previous: { hadExisting: boolean; existingValue?: string }): Promise<void> {
    if (previous.hadExisting) {
        await db.appConfig.update({ where: { key: "SUNDAY_DIGEST_TO" }, data: { value: previous.existingValue ?? "" } });
    } else {
        await db.appConfig.deleteMany({ where: { key: "SUNDAY_DIGEST_TO" } });
    }
}

async function cleanupDraft(draftId: string): Promise<void> {
    if (!safeDatabase) return;
    await db.delivery.deleteMany({ where: { event: { sourceId: draftId, sourceType: "weekly_report" } } });
    await db.notificationEvent.deleteMany({ where: { sourceId: draftId, sourceType: "weekly_report" } });
    await db.weeklyReport.deleteMany({ where: { id: draftId } });
}

function acceptedSender(sent: string[]): DigestEmailSender {
    return async ({ to }) => {
        sent.push(to);
        return { outcome: "accepted", providerId: `c07-provider-${sent.length}` };
    };
}

describe("digest preview and approved delivery", () => {
    it("preview makes zero writes", async () => {
        // Count only this test family's rows: parallel vitest files share the
        // gate database, so global counts legitimately fluctuate between the
        // before/after snapshots. buildDigestPreview is still proven
        // write-zero — for the rows IT could create.
        const countScoped = () => Promise.all([
            db.weeklyReport.count({ where: { id: { startsWith: "c07-" } } }),
            db.notificationEvent.count({ where: { dedupeKey: { startsWith: "c07-" } } }),
            db.delivery.count({ where: { event: { dedupeKey: { startsWith: "c07-" } } } }),
        ]);

        const before = await countScoped();
        await buildDigestPreview(db, { ...fixedPeriod, actorScopes });
        const after = await countScoped();
        expect(after).toEqual(before);
    });

    it("duplicates send once", async () => {
        const previous = await setRecipients("A@x.com, a@X.com");
        const { draftId } = await makeDraft();
        const sent: string[] = [];

        try {
            const result = await sendApprovedDigest(
                db,
                { draftId, internalDomains: ["x.com"] },
                acceptedSender(sent),
            );
            const deliveries = await db.delivery.findMany({ where: { event: { sourceId: draftId } } });

            expect(result.validation.valid).toHaveLength(1);
            expect(result.validation.duplicatesRemoved).toHaveLength(1);
            expect(sent).toEqual(["a@x.com"]);
            expect(deliveries).toHaveLength(1);
            expect(deliveries[0]).toMatchObject({
                channel: "email",
                destinationKey: "a@x.com",
                providerId: "c07-provider-1",
            });
        } finally {
            await cleanupDraft(draftId);
            await restoreRecipients(previous);
        }
    });

    it("external recipient requires explicit approval", async () => {
        const previous = await setRecipients("person@outside.example");
        const { draftId } = await makeDraft();
        const sent: string[] = [];

        try {
            const blocked = await sendApprovedDigest(
                db,
                { draftId, internalDomains: ["example.test"], explicitExternalApproval: false },
                acceptedSender(sent),
            );
            expect(blocked.validation.externalBlocked).toEqual(["person@outside.example"]);
            expect(sent).toHaveLength(0);
            expect(await db.delivery.count({ where: { event: { sourceId: draftId } } })).toBe(0);

            const approved = await sendApprovedDigest(
                db,
                { draftId, internalDomains: ["example.test"], explicitExternalApproval: true },
                acceptedSender(sent),
            );
            expect(approved.validation.valid).toEqual(["person@outside.example"]);
            expect(sent).toEqual(["person@outside.example"]);
            expect(await db.delivery.count({ where: { event: { sourceId: draftId } } })).toBe(1);
        } finally {
            await cleanupDraft(draftId);
            await restoreRecipients(previous);
        }
    });

    it("invalid addresses are rejected not sent", async () => {
        const previous = await setRecipients("not-an-email");
        const { draftId } = await makeDraft();
        const sent: string[] = [];

        try {
            const result = await sendApprovedDigest(db, { draftId }, acceptedSender(sent));
            expect(result.validation.invalid).toEqual(["not-an-email"]);
            expect(sent).toHaveLength(0);
            expect(await db.delivery.count({ where: { event: { sourceId: draftId } } })).toBe(0);
            expect(parseAndValidateRecipients("not-an-email", { allowExternal: false }).valid).toHaveLength(0);
        } finally {
            await cleanupDraft(draftId);
            await restoreRecipients(previous);
        }
    });
});
