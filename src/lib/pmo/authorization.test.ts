import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { writePmoAudit } from "./audit";
import {
    assertCanAttachToParent,
    assertCanManageExternalAction,
    canCreatePmoAction,
    canManageExternalAction,
    canManageWorkAreas,
    PmoForbiddenError,
    type PmoRole,
} from "./authorization";

const context = {
    ownerId: "owner",
    parentOwnerId: "parent",
    ownerManagerId: "manager",
};

describe("PMO authorization", () => {
    it.each([
        ["ADMIN", true],
        ["MANAGER", true],
        ["MEMBER", false],
        ["VIEWER", false],
    ])("only ADMIN/MANAGER may manage work-area definitions: %s → %s", (role, expected) => {
        expect(canManageWorkAreas({ id: (role as string).toLowerCase(), role: role as PmoRole })).toBe(expected);
    });

    describe("assertCanAttachToParent (plan 016)", () => {
        const parent = { ownerId: "owner", memberIds: ["member"] };
        it.each([
            ["admin", "ADMIN"],
            ["owner", "MEMBER"],
            ["member", "MEMBER"],
        ])("permits %s to attach an action to the parent", (id, role) => {
            expect(() => assertCanAttachToParent({ id, role: role as PmoRole }, parent)).not.toThrow();
        });

        it("rejects an unrelated non-admin actor", () => {
            expect(() => assertCanAttachToParent({ id: "stranger", role: "MEMBER" }, parent)).toThrow(PmoForbiddenError);
        });

        it("rejects a member of a different parent when the parent has no owner", () => {
            expect(() => assertCanAttachToParent({ id: "stranger", role: "MEMBER" }, { ownerId: null, memberIds: [] })).toThrow(PmoForbiddenError);
        });
    });

    it.each([
        ["ADMIN", true],
        ["MANAGER", true],
        ["MEMBER", true],
        ["VIEWER", false],
    ])("allows %s actors to create actions: %s", (role, expected) => {
        expect(canCreatePmoAction({ id: role.toLowerCase(), role: role as PmoRole })).toBe(expected);
    });

    it.each([
        ["owner", "MEMBER"],
        ["parent", "MEMBER"],
        ["manager", "MEMBER"],
        ["admin", "ADMIN"],
    ])("permits related actor %s", (id, role) => {
        expect(canManageExternalAction({ id, role: role as PmoRole }, context)).toBe(true);
    });

    it("does not grant every manager global action access", () => {
        expect(
            canManageExternalAction({ id: "other", role: "MANAGER" }, context),
        ).toBe(false);
    });

    it("denies unrelated non-admin actors", () => {
        expect(
            canManageExternalAction({ id: "other", role: "MEMBER" }, context),
        ).toBe(false);
    });

    it("throws the policy-specific error when action access is denied", () => {
        expect(() =>
            assertCanManageExternalAction(
                { id: "other", role: "MANAGER" },
                context,
            ),
        ).toThrow(PmoForbiddenError);
    });

    it("does not throw when action access is allowed", () => {
        expect(() =>
            assertCanManageExternalAction(
                { id: "owner", role: "MEMBER" },
                context,
            ),
        ).not.toThrow();
    });
});

describe("writePmoAudit", () => {
    it("serializes fields arrays and permitted metadata keys", async () => {
        const create = vi.fn().mockResolvedValue({});
        const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
        const fields = ["title", "status"] as const;

        await writePmoAudit(tx, {
            entityType: "external_action",
            entityId: "action",
            action: "update",
            actorId: "actor",
            taskId: "task",
            changes: {
                fields,
                statusFrom: "TODO",
                statusTo: "DOING",
                isArchived: false,
                success: true,
                source: "manual",
                reason: "corrected",
            },
        });

        expect(create).toHaveBeenCalledWith({
            data: {
                entityType: "external_action",
                entityId: "action",
                action: "update",
                actorId: "actor",
                taskId: "task",
                metaJson: JSON.stringify({
                    fields,
                    statusFrom: "TODO",
                    statusTo: "DOING",
                    isArchived: false,
                    success: true,
                    source: "manual",
                    reason: "corrected",
                }),
            },
        });
    });

    it.each([
        ["contact_email", "email"],
        ["RecipientName", "recipient"],
        ["draft-body", "body"],
        ["evidenceUrl", "url"],
        ["SYSTEM_PROMPT", "prompt"],
        ["clientSecret", "secret"],
        ["access.token", "token"],
        ["passwordHash", "password"],
        ["api-credential", "credential"],
    ])(
        "rejects the normalized %s key before writing",
        async (key, category) => {
            const create = vi.fn().mockResolvedValue({});
            const tx = {
                auditLog: { create },
            } as unknown as Prisma.TransactionClient;
            const sensitiveValue = `sensitive-${category}-value`;
            let thrown: unknown;

            try {
                await writePmoAudit(tx, {
                    entityType: "external_action",
                    entityId: "action",
                    action: "update",
                    actorId: "actor",
                    changes: { [key]: sensitiveValue },
                });
            } catch (error) {
                thrown = error;
            }

            expect(thrown).toBeInstanceOf(Error);
            expect((thrown as Error).message).toBe(
                `Unsafe PMO audit metadata key: ${key}`,
            );
            expect((thrown as Error).message).not.toContain(sensitiveValue);
            expect(create).not.toHaveBeenCalled();
        },
    );
});
