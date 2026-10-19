import { describe, expect, it, vi } from "vitest";
import {
    addEvidence,
    recordExternalResponse,
    removeEvidence,
    transitionExternalAction,
    validateClosureBasis,
    validateEvidenceRemoval,
} from "./lifecycle-service";

const actor = { id: "owner", role: "MEMBER" as const };

function action(status: string, evidenceCount: number, closureNote: string | null = null) {
    return {
        id: "task",
        status,
        project: { ownerId: "parent" },
        caseStudy: null,
        externalAction: {
            id: "action",
            ownerId: "owner",
            owner: { managerId: null },
            closureNote,
            _count: { evidence: evidenceCount },
        },
    };
}

describe("PMO lifecycle invariants", () => {
    it("requires evidence or a closure note", () => {
        expect(() => validateClosureBasis(0, "")).toThrow("Add evidence or a closure note before closing");
        expect(() => validateClosureBasis(1, "")).not.toThrow();
        expect(() => validateClosureBasis(0, "Closed by executive decision")).not.toThrow();
    });

    it("protects the last closure basis", () => {
        expect(() => validateEvidenceRemoval({ status: "DONE", evidenceCount: 1, closureNote: null })).toThrow("Closed action must retain evidence or a closure note");
    });

    it("rechecks closure evidence inside the transaction", async () => {
        const db = {
            task: { findFirst: vi.fn().mockResolvedValue(action("WAITING", 0)) },
            externalAction: { update: vi.fn() },
            auditLog: { create: vi.fn() },
            $executeRawUnsafe: vi.fn(),
            $transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(db as never)),
        };

        await expect(transitionExternalAction("task", { action: "close" }, actor, db as never)).rejects.toThrow("Add evidence or a closure note before closing");
        expect(db.externalAction.update).not.toHaveBeenCalled();
    });

    it("rechecks the last evidence inside the removal transaction", async () => {
        const db = {
            task: { findFirst: vi.fn().mockResolvedValue(action("DONE", 1)) },
            actionEvidence: { findFirst: vi.fn().mockResolvedValue({ id: "evidence" }), delete: vi.fn() },
            auditLog: { create: vi.fn() },
            $executeRawUnsafe: vi.fn(),
            $transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(db as never)),
        };

        await expect(removeEvidence("task", "evidence", actor, db as never)).rejects.toThrow("Closed action must retain evidence or a closure note");
        expect(db.actionEvidence.delete).not.toHaveBeenCalled();
    });

    it("persists a trimmed cancellation reason in safe audit metadata", async () => {
        const db = {
            task: { findFirst: vi.fn().mockResolvedValue(action("WAITING", 0)), update: vi.fn(), findUnique: vi.fn() },
            externalAction: { update: vi.fn() },
            auditLog: { create: vi.fn() },
            $executeRawUnsafe: vi.fn(),
            $transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(db as never)),
        };

        await transitionExternalAction("task", { action: "cancel", reason: "  Vendor withdrew  " }, actor, db as never);

        expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ metaJson: JSON.stringify({ fields: ["status", "reason"], reason: "Vendor withdrew" }) }),
        }));
    });
});

describe("PMO lifecycle state machine — characterization (plan 011)", () => {
    function terminalDb(status: string) {
        const db = {
            task: { findFirst: vi.fn().mockResolvedValue(action(status, 1, "closed earlier")), update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ id: "task", externalAction: {} }) },
            externalAction: { update: vi.fn() },
            comment: { create: vi.fn() },
            actionEvidence: { create: vi.fn() },
            auditLog: { create: vi.fn() },
            $executeRawUnsafe: vi.fn(),
            $transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(db as never)),
        };
        return db;
    }

    it("rejects closing an already-closed action (does not overwrite the closer) — fixed by plan 011", async () => {
        const db = terminalDb("DONE");
        await expect(transitionExternalAction("task", { action: "close", closureNote: "again" }, actor, db as never)).rejects.toThrow();
        expect(db.externalAction.update).not.toHaveBeenCalled();
    });

    it("rejects reopening a non-terminal action — fixed by plan 011", async () => {
        const db = terminalDb("WAITING");
        await expect(transitionExternalAction("task", { action: "reopen" }, actor, db as never)).rejects.toThrow();
        expect(db.task.update).not.toHaveBeenCalled();
    });

    it("still allows reopening a terminal action", async () => {
        const db = terminalDb("DONE");
        await expect(transitionExternalAction("task", { action: "reopen" }, actor, db as never)).resolves.toBeDefined();
        expect(db.task.update).toHaveBeenCalled();
    });

    it("rejects recording an external response on a terminal action — fixed by plan 011", async () => {
        const db = terminalDb("CANCELED");
        await expect(recordExternalResponse("task", { comment: "late reply" }, actor, db as never)).rejects.toThrow();
        expect(db.comment.create).not.toHaveBeenCalled();
    });

    it("rejects adding evidence to a terminal action — fixed by plan 011", async () => {
        const db = terminalDb("DONE");
        await expect(addEvidence("task", { label: "doc", url: "https://example.com/doc" }, actor, db as never)).rejects.toThrow();
        expect(db.actionEvidence.create).not.toHaveBeenCalled();
    });
});
