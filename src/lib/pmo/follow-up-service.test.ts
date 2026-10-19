import { describe, expect, it, vi } from "vitest";
import { markFollowUpSent } from "./follow-up-service";

describe("markFollowUpSent", () => {
    it("associates explicit confirmation with the selected scheduled event", async () => {
        const fake = {
            task: {
                findFirst: vi.fn().mockResolvedValue({
                    id: "task",
                    project: { ownerId: "parent" },
                    caseStudy: null,
                    externalAction: { id: "action", ownerId: "owner", owner: { managerId: null } },
                }),
            },
            followUpEvent: {
                findFirst: vi.fn().mockResolvedValue({ id: "event", sentAt: null }),
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
                findUnique: vi.fn().mockResolvedValue({ id: "event" }),
            },
            auditLog: { create: vi.fn() },
            $transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(fake as never)),
        };

        await markFollowUpSent(
            "task",
            { eventId: "event", confirmedSent: true, recipient: "external@example.com", subject: "Update", body: "Body" },
            { id: "owner", role: "MEMBER" },
            fake as never,
        );

        expect(fake.followUpEvent.findFirst).toHaveBeenCalledWith({
            where: { id: "event", externalActionId: "action", triggerType: { not: "MANUAL" }, sentAt: null },
        });
        expect(fake.followUpEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "event", externalActionId: "action", sentAt: null },
            data: expect.objectContaining({ sentById: "owner", finalSubject: "Update" }),
        }));
    });

    it("rejects a missing scheduled event", async () => {
        const fake = {
            task: { findFirst: vi.fn().mockResolvedValue({ project: null, caseStudy: null, externalAction: { id: "action", ownerId: "owner", owner: { managerId: null } } }) },
            followUpEvent: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn(), findUnique: vi.fn() },
            auditLog: { create: vi.fn() },
            $transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(fake as never)),
        };

        await expect(markFollowUpSent(
            "task",
            { eventId: "event", confirmedSent: true, recipient: "external@example.com", subject: "Update", body: "Body" },
            { id: "owner", role: "MEMBER" },
            fake as never,
        )).rejects.toThrow("Scheduled follow-up event not found");
    });

    it("creates a sent manual event when no scheduled event is available", async () => {
        const manual = { id: "manual-event", triggerType: "MANUAL", sentAt: new Date() };
        const fake = {
            task: { findFirst: vi.fn().mockResolvedValue({ project: null, caseStudy: null, externalAction: { id: "action", ownerId: "owner", owner: { managerId: null } } }) },
            followUpEvent: {
                findFirst: vi.fn().mockResolvedValue(null),
                create: vi.fn().mockResolvedValue(manual),
            },
            auditLog: { create: vi.fn() },
            $transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(fake as never)),
        };

        await expect(markFollowUpSent(
            "task",
            { confirmedSent: true, recipient: "external@example.com", subject: "Manual update", body: "Body" },
            { id: "owner", role: "MEMBER" },
            fake as never,
        )).resolves.toBe(manual);

        expect(fake.followUpEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                externalActionId: "action",
                triggerType: "MANUAL",
                ownerId: "owner",
                finalRecipient: "external@example.com",
                finalSubject: "Manual update",
                finalBody: "Body",
                sentById: "owner",
            }),
        });
    });

    it("requires the pending scheduled event instead of creating a manual event", async () => {
        const fake = {
            task: { findFirst: vi.fn().mockResolvedValue({ project: null, caseStudy: null, externalAction: { id: "action", ownerId: "owner", owner: { managerId: null } } }) },
            followUpEvent: {
                findFirst: vi.fn().mockResolvedValue({ id: "scheduled-event" }),
                create: vi.fn(),
            },
            auditLog: { create: vi.fn() },
            $transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(fake as never)),
        };

        await expect(markFollowUpSent(
            "task",
            { confirmedSent: true, recipient: "external@example.com", subject: "Manual update", body: "Body" },
            { id: "owner", role: "MEMBER" },
            fake as never,
        )).rejects.toThrow("Scheduled follow-up event must be used");
        expect(fake.followUpEvent.create).not.toHaveBeenCalled();
    });
});
