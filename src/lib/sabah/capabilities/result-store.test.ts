import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { createPrismaCapabilityResultStore, type CapabilityResultDb } from "./result-store";

type FakeRow = {
    id: string;
    key: string;
    state: string;
    outputJson: string | null;
    compensatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

function createFakeDelegate() {
    const rows = new Map<string, FakeRow>();
    const db = {
        aiCapabilityResult: {
            findUnique: vi.fn(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null),
            create: vi.fn(async ({ data }: { data: { key: string; state: string; outputJson: string | null } }) => {
                if (rows.has(data.key)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
                const row: FakeRow = { ...data, id: `res_${rows.size + 1}`, compensatedAt: null, createdAt: new Date(), updatedAt: new Date() };
                rows.set(data.key, row);
                return row;
            }),
            updateMany: vi.fn(async ({ where, data }: { where: { key: string; state: string; compensatedAt: null }; data: { state: string; outputJson: string | null } }) => {
                const row = rows.get(where.key);
                if (!row || row.state !== where.state || row.compensatedAt !== where.compensatedAt) return { count: 0 };
                rows.set(where.key, { ...row, ...data, updatedAt: new Date() });
                return { count: 1 };
            }),
            upsert: vi.fn(async ({ where, create, update }: {
                where: { key: string };
                create: { key: string; state: string; outputJson: string | null; compensatedAt?: Date | null };
                update: { state?: string; outputJson?: string | null; compensatedAt?: Date | null };
            }) => {
                const existing = rows.get(where.key);
                const next: FakeRow = existing
                    ? { ...existing, ...update, updatedAt: new Date() }
                    : {
                        id: `res_${rows.size + 1}`,
                        key: create.key,
                        state: create.state,
                        outputJson: create.outputJson ?? null,
                        compensatedAt: create.compensatedAt ?? null,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                rows.set(where.key, next);
                return next;
            }),
        },
    };
    return { rows, db: db as unknown as CapabilityResultDb, raw: db };
}

describe("PrismaCapabilityResultStore", () => {
    it("round-trips a saved result through getPriorResult", async () => {
        const { db } = createFakeDelegate();
        const store = createPrismaCapabilityResultStore(db);

        await store.saveResult("wf-1:step-a", { state: "VERIFIED", output: { id: "task_1", title: "Created" } });
        const prior = await store.getPriorResult("wf-1:step-a");

        expect(prior).toEqual({ state: "VERIFIED", output: { id: "task_1", title: "Created" } });
    });

    it("returns null for an unknown key", async () => {
        const { db } = createFakeDelegate();
        const store = createPrismaCapabilityResultStore(db);

        expect(await store.getPriorResult("missing")).toBeNull();
    });

    it("atomically grants only one execution claim for a key", async () => {
        const { db } = createFakeDelegate();
        const store = createPrismaCapabilityResultStore(db) as any;

        const claims = await Promise.all([store.claimExecution("wf-1:step-a"), store.claimExecution("wf-1:step-a")]);

        expect(claims.filter((claim: { state: string }) => claim.state === "CLAIMED")).toHaveLength(1);
        expect(claims.filter((claim: { state: string }) => claim.state === "BUSY")).toHaveLength(1);
    });

    it("does not overwrite a verified result", async () => {
        const { db } = createFakeDelegate();
        const store = createPrismaCapabilityResultStore(db) as any;
        expect((await store.claimExecution("wf-1:step-b")).state).toBe("CLAIMED");
        await store.saveResult("wf-1:step-b", { state: "VERIFIED", output: { first: true } });

        await expect(store.saveResult("wf-1:step-b", { state: "VERIFIED", output: { second: true } })).rejects.toThrow(/already finalized/i);
        expect(await store.getPriorResult("wf-1:step-b")).toEqual({ state: "VERIFIED", output: { first: true } });
    });

    it("persists undefined output as a null column and replays it as null output", async () => {
        const { db, raw } = createFakeDelegate();
        const store = createPrismaCapabilityResultStore(db);

        await store.saveResult("wf-1:step-b", { state: "VERIFIED", output: undefined });

        expect(raw.aiCapabilityResult.create).toHaveBeenCalledWith({
            data: { key: "wf-1:step-b", state: "VERIFIED", outputJson: null },
        });
        expect(await store.getPriorResult("wf-1:step-b")).toEqual({ state: "VERIFIED", output: null });
    });

    it("refuses to promote a non-claimed failed result", async () => {
        const { db } = createFakeDelegate();
        const store = createPrismaCapabilityResultStore(db);

        await store.saveResult("wf-1:step-c", { state: "FAILED", output: null });
        await expect(store.saveResult("wf-1:step-c", { state: "VERIFIED", output: { ok: true } })).rejects.toThrow(/already finalized/i);

        expect(await store.getPriorResult("wf-1:step-c")).toEqual({ state: "FAILED", output: null });
    });

    it("does not replay a result whose stored output is malformed JSON", async () => {
        const { db, rows } = createFakeDelegate();
        const store = createPrismaCapabilityResultStore(db);
        rows.set("wf-1:bad", { id: "res_bad", key: "wf-1:bad", state: "VERIFIED", outputJson: "{not json", compensatedAt: null, createdAt: new Date(), updatedAt: new Date() });

        expect(await store.getPriorResult("wf-1:bad")).toBeNull();
    });

    it("marks a key compensated durably, even without a prior saved result", async () => {
        const now = new Date("2026-09-01T08:00:00.000Z");
        const { db } = createFakeDelegate();
        const store = createPrismaCapabilityResultStore(db, () => now);

        expect(await store.isCompensated("wf-2:step-a")).toBe(false);
        await store.markCompensated("wf-2:step-a");
        expect(await store.isCompensated("wf-2:step-a")).toBe(true);
    });

    it("stops replaying results after compensation", async () => {
        const { db } = createFakeDelegate();
        const store = createPrismaCapabilityResultStore(db);

        await store.saveResult("wf-3:step-a", { state: "VERIFIED", output: { done: true } });
        await store.markCompensated("wf-3:step-a");

        expect(await store.getPriorResult("wf-3:step-a")).toBeNull();
        expect(await store.isCompensated("wf-3:step-a")).toBe(true);
    });

    it("rejects blank idempotency keys", async () => {
        const { db } = createFakeDelegate();
        const store = createPrismaCapabilityResultStore(db);

        await expect(store.getPriorResult("")).rejects.toThrow(/key/i);
        await expect(store.saveResult("", { state: "VERIFIED", output: null })).rejects.toThrow(/key/i);
        await expect(store.markCompensated(" ")).rejects.toThrow(/key/i);
        await expect(Promise.resolve(store.isCompensated(""))).rejects.toThrow(/key/i);
    });
});
