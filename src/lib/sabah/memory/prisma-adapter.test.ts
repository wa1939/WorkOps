import { describe, expect, it, vi } from "vitest";
import { createPrismaMemoryAdapter } from "@/lib/sabah/capabilities/modules/learning";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

type FakeDb = ReturnType<typeof makeDb>;

const source = {
    entityType: "NOTE",
    entityId: "n1",
    label: "Visible note",
    href: "/notes/n1",
    sourceUpdatedAt: "2026-08-20T00:00:00.000Z",
    checksum: "abc123",
};

const row = (state: string = "PROPOSED") => ({
    id: "m1",
    scope: "USER",
    kind: "FACT",
    state,
    content: "Use the approved wording.",
    provenance: "USER_PROVIDED",
    confidence: 0.9,
    freshness: "FRESH",
    expiresAt: null,
    supersededById: null,
    ownerId: "u1",
    departmentId: null,
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
    updatedAt: new Date("2026-08-20T00:00:00.000Z"),
    sources: [{
        sourceType: source.entityType,
        sourceId: source.entityId,
        locatorJson: JSON.stringify(source),
    }],
});

const approval = (action: "APPROVED" | "REJECTED" = "APPROVED") => ({
    actorId: "lead-1",
    action,
    metaJson: JSON.stringify({ source: "sabah-memory", state: action, reason: "Human decision" }),
    createdAt: new Date("2026-08-21T00:00:00.000Z"),
});

function makeDb() {
    const db = {
        aiMemory: {
            findMany: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn(),
            updateMany: vi.fn(),
        },
        auditLog: {
            findFirst: vi.fn(),
            create: vi.fn(),
        },
        $transaction: vi.fn(),
    };
    db.$transaction.mockImplementation(async (work: (tx: FakeDb) => unknown) => work(db));
    return db;
}

function createInput(state: string, withApproval = true) {
    return {
        ...row(state),
        id: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        sources: [source],
        ...(withApproval ? { approval: { actorId: "lead-1", at: new Date("2026-08-21T00:00:00.000Z"), reason: "Human decision" } } : {}),
    };
}

describe("Prisma memory approval adapter", () => {
    it("writes approval provenance in the audit log and hydrates it on create", async () => {
        const db = makeDb();
        db.aiMemory.create.mockResolvedValue(row("APPROVED"));
        db.auditLog.findFirst.mockResolvedValue(approval("APPROVED"));
        const adapter = createPrismaMemoryAdapter(db as never);

        const result = await adapter.create(createInput("APPROVED") as never);

        expect(db.$transaction).toHaveBeenCalledTimes(1);
        expect(db.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                entityType: "ai_memory",
                entityId: "m1",
                action: "APPROVED",
                actorId: "lead-1",
                metaJson: JSON.stringify({ source: "sabah-memory", state: "APPROVED", reason: "Human decision" }),
            }),
        });
        expect(result).toMatchObject({ id: "m1", state: "APPROVED", approval: { actorId: "lead-1", reason: "Human decision" } });
    });

    it("updates state and approval audit together through the compare-and-set transaction", async () => {
        const db = makeDb();
        db.aiMemory.updateMany.mockResolvedValue({ count: 1 });
        db.aiMemory.findUnique.mockResolvedValue(row("REJECTED"));
        db.auditLog.findFirst.mockResolvedValue(approval("REJECTED"));
        const adapter = createPrismaMemoryAdapter(db as never);

        const result = await adapter.update("m1", {
            state: "REJECTED",
            approval: { actorId: "lead-1", at: new Date("2026-08-21T00:00:00.000Z"), reason: "Human decision" },
        }, { state: "IN_REVIEW" as never });

        expect(db.aiMemory.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "m1", state: "IN_REVIEW" },
            data: { state: "REJECTED" },
        }));
        expect(db.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ entityId: "m1", action: "REJECTED", actorId: "lead-1" }),
        });
        expect(result).toMatchObject({ state: "REJECTED", approval: { actorId: "lead-1" } });
    });

    it("fails closed before mutating when approval provenance has a non-decision state", async () => {
        const db = makeDb();
        const adapter = createPrismaMemoryAdapter(db as never);

        await expect(adapter.create(createInput("PROPOSED") as never)).rejects.toMatchObject({ code: "MEMORY_AUDIT_UNAVAILABLE" });
        expect(db.aiMemory.create).not.toHaveBeenCalled();
        expect(db.auditLog.create).not.toHaveBeenCalled();
    });

    it("does not expose malformed audit rows as approval provenance", async () => {
        const db = makeDb();
        db.aiMemory.findUnique.mockResolvedValue(row("APPROVED"));
        db.auditLog.findFirst.mockResolvedValue({ ...approval("APPROVED"), metaJson: "{}" });
        const adapter = createPrismaMemoryAdapter(db as never);

        const result = await adapter.get("m1");

        expect(result).toMatchObject({ id: "m1", state: "APPROVED" });
        expect(result?.approval).toBeUndefined();
    });
});
