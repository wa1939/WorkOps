import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/sabah/auth/actor", () => ({
    toSabahActor: vi.fn(),
    SabahForbiddenError: class extends Error {},
}));

import { listDiagnostics, type DiagnosticsFilters } from "./admin";

const filters = (overrides: Partial<DiagnosticsFilters> = {}): DiagnosticsFilters => ({
    view: "all",
    source: "all",
    limit: 1,
    ...overrides,
});

describe("diagnostics admin query correctness", () => {
    it("continues conversations by updatedAt rather than createdAt", async () => {
        const cursorAt = new Date("2026-08-10T12:00:00.000Z");
        const olderByUpdate = {
            id: "conversation-old",
            title: "Old by update",
            userId: "user-1",
            // This conversation was created after the cursor row but has an older update.
            createdAt: new Date("2026-08-11T12:00:00.000Z"),
            updatedAt: new Date("2026-08-09T12:00:00.000Z"),
            user: null,
            _count: { messages: 1 },
        };
        const conversationFindMany = vi.fn(async ({ where }: { where: Record<string, any> }) => {
            const after = where.AND?.find((part: Record<string, any>) => part.OR)?.OR;
            if (!after) return [olderByUpdate];
            const field = Object.keys(after[0])[0];
            const operator = Object.keys(after[0][field])[0];
            const value = after[0][field][operator] as Date;
            return field === "updatedAt" && operator === "lt" && olderByUpdate.updatedAt < value
                ? [olderByUpdate]
                : [];
        });
        const db = {
            aiConversation: { findMany: conversationFindMany },
        } as any;

        const result = await listDiagnostics(filters({
            view: "chats",
            chatCursor: { scope: "conversations", at: cursorAt, id: "conversation-new" },
        }), db, new Date("2026-08-20T00:00:00.000Z"));

        expect(result.conversations.map(({ id }) => id)).toEqual(["conversation-old"]);
        expect(conversationFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                AND: expect.arrayContaining([
                    expect.objectContaining({
                        OR: expect.arrayContaining([
                            expect.objectContaining({ updatedAt: { lt: cursorAt } }),
                        ]),
                    }),
                ]),
            }),
        }));
    });

    it("derives diagnostic messages from metadata.message", async () => {
        const auditLogFindMany = vi.fn().mockResolvedValue([{
            id: "diagnostic-message",
            entityType: "SYSTEM_DIAGNOSTIC",
            entityId: "correlation-message",
            action: "CHAT_REQUEST_START",
            metaJson: JSON.stringify({
                correlationId: "correlation-message",
                category: "CHAT_REQUEST_START",
                level: "INFO",
                message: "message persisted in metadata",
            }),
            createdAt: new Date("2026-08-19T12:00:00.000Z"),
        }]);
        const db = { auditLog: { findMany: auditLogFindMany } } as any;

        const result = await listDiagnostics(filters({ view: "logs", source: "diagnostic" }), db, new Date("2026-08-20T00:00:00.000Z"));

        expect(result.logs).toHaveLength(1);
        expect(result.logs[0].message).toBe("message persisted in metadata");
    });

    it("pushes diagnostic level and category filters below the source page cap", async () => {
        const newerNonMatches = Array.from({ length: 6 }, (_, index) => ({
            id: `diagnostic-new-${index}`,
            entityType: "SYSTEM_DIAGNOSTIC",
            entityId: `correlation-new-${index}`,
            action: "CHAT_REQUEST_START",
            metaJson: JSON.stringify({ level: "INFO", message: "newer non-match" }),
            createdAt: new Date(Date.UTC(2026, 7, 19, 12 - index, 0, 0)),
        }));
        const olderMatches = [0, 1].map((index) => ({
            id: `diagnostic-match-${index}`,
            entityType: "SYSTEM_DIAGNOSTIC",
            entityId: `correlation-match-${index}`,
            action: "CHAT_REQUEST_FAILURE",
            metaJson: JSON.stringify({ level: "ERROR", message: `older match ${index}` }),
            createdAt: new Date(Date.UTC(2026, 7, 19, 5 - index, 0, 0)),
        }));
        const rows = [...newerNonMatches, ...olderMatches];
        const auditLogFindMany = vi.fn(async ({ where, take }: { where: Record<string, any>; take: number }) => {
            const levelFragment = where.metaJson?.contains;
            const actionFilter = where.action;
            const action = typeof actionFilter === "string" ? actionFilter : actionFilter?.equals;
            return rows
                .filter((row) => !levelFragment || row.metaJson.includes(levelFragment))
                .filter((row) => !action || row.action.toLowerCase() === String(action).toLowerCase())
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(0, take);
        });
        const db = { auditLog: { findMany: auditLogFindMany } } as any;

        const result = await listDiagnostics(filters({
            view: "logs",
            source: "diagnostic",
            level: "ERROR",
            category: "CHAT_REQUEST_FAILURE",
        }), db, new Date("2026-08-20T00:00:00.000Z"));

        expect(result.logs.map(({ id }) => id)).toEqual(["diagnostic-match-0"]);
        expect(result.pagination.logs.hasMore).toBe(true);
        expect(auditLogFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                action: expect.objectContaining({ equals: "CHAT_REQUEST_FAILURE" }),
                metaJson: { contains: '"level":"ERROR"' },
            }),
        }));
    });

    it("pushes audit category and correlation filters below the source page cap", async () => {
        const newerNonMatches = Array.from({ length: 6 }, (_, index) => ({
            id: `audit-new-${index}`,
            entityType: "TASK",
            entityId: `entity-new-${index}`,
            action: "TASK_UPDATED",
            metaJson: JSON.stringify({ correlationId: `other-correlation-${index}`, message: "newer non-match" }),
            createdAt: new Date(Date.UTC(2026, 7, 19, 12 - index, 0, 0)),
        }));
        const olderMatches = [0, 1].map((index) => ({
            id: `audit-match-${index}`,
            entityType: "TASK",
            entityId: `entity-match-${index}`,
            action: "TASK_FAILED",
            metaJson: JSON.stringify({ correlationId: "audit-correlation-target", message: `older match ${index}` }),
            createdAt: new Date(Date.UTC(2026, 7, 19, 5 - index, 0, 0)),
        }));
        const rows = [...newerNonMatches, ...olderMatches];
        const auditLogFindMany = vi.fn(async ({ where, take }: { where: Record<string, any>; take: number }) => {
            const clauses = where.AND ?? [where];
            const actionFilter = clauses.find((clause: Record<string, any>) => clause.action)?.action;
            const metadataFilters = clauses
                .map((clause: Record<string, any>) => clause.metaJson?.contains)
                .filter(Boolean);
            const action = typeof actionFilter === "string" ? actionFilter : actionFilter?.equals;
            return rows
                .filter((row) => !action || row.action.toLowerCase() === String(action).toLowerCase())
                .filter((row) => metadataFilters.every((fragment: string) => row.metaJson.includes(fragment)))
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(0, take);
        });
        const db = { auditLog: { findMany: auditLogFindMany } } as any;

        const result = await listDiagnostics(filters({
            view: "logs",
            source: "audit",
            category: "TASK_FAILED",
            correlationId: "audit-correlation-target",
        }), db, new Date("2026-08-20T00:00:00.000Z"));

        expect(result.logs.map(({ id }) => id)).toEqual(["audit-match-0"]);
        expect(result.pagination.logs.hasMore).toBe(true);
        expect(auditLogFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                action: expect.objectContaining({ equals: "TASK_FAILED" }),
                metaJson: { contains: '"correlationId":"audit-correlation-target"' },
            }),
        }));
    });
});
