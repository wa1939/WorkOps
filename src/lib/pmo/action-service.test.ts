import { describe, expect, it, vi } from "vitest";
import { assertExternalActionStatusEditable, createExternalAction, updateExternalAction } from "./action-service";

describe("createExternalAction", () => {
    it("requires lifecycle reopen for closed actions", () => {
        expect(() => assertExternalActionStatusEditable("DONE", "WAITING")).toThrow("Reopen the action through the PMO lifecycle first");
        expect(() => assertExternalActionStatusEditable("CANCELED", "DOING")).toThrow("Reopen the action through the PMO lifecycle first");
        expect(() => assertExternalActionStatusEditable("WAITING", "DOING")).not.toThrow();
    });
    it("creates the complete action in one transaction", async () => {
        const fake = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: "owner", role: "MEMBER", isActive: true }), findMany: vi.fn().mockResolvedValue([{ id: "owner" }, { id: "collaborator" }]) },
            externalContact: { findUnique: vi.fn().mockResolvedValue({ id: "contact", isArchived: false }) },
            tag: { findMany: vi.fn().mockResolvedValue([{ id: "tag-1" }]) },
            project: { findUnique: vi.fn().mockResolvedValue({ id: "project-1", ownerId: "parent", workAreaId: "area", members: [{ userId: "creator" }], workArea: { id: "area", isArchived: false } }), update: vi.fn() },
            caseStudy: { findUnique: vi.fn() },
            task: { create: vi.fn().mockResolvedValue({ id: "task-1" }), findMany: vi.fn().mockResolvedValue([{ id: "dependency-1" }]) },
            taskDependency: { createMany: vi.fn() },
            externalAction: { create: vi.fn().mockResolvedValue({ id: "action-1" }) },
            reminderRule: { createMany: vi.fn() }, auditLog: { create: vi.fn() },
            $transaction: vi.fn(async (callback) => callback(fake)),
        };

        await createExternalAction({
            title: "Submit evidence", description: "Provide the signed report", priority: "HIGH", ownerId: "owner",
            externalContactId: "contact", dueDate: "2026-08-12", projectId: "project-1", caseStudyId: null,
            collaboratorIds: ["collaborator", "owner"], reminderOffsets: [30, 7, 0], overdueIntervalDays: 7,
            tagIds: ["tag-1"], dependencyIds: ["dependency-1"],
        }, { id: "creator", role: "MEMBER" }, fake as never);

        expect(fake.$transaction).toHaveBeenCalledOnce();
        expect(fake.task.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
            type: "EXTERNAL_ACTION", status: "WAITING", isPrivate: false, projectId: "project-1", caseStudyId: null,
            assignments: { create: [{ userId: "owner" }, { userId: "collaborator" }] },
        }) }));
        expect(fake.reminderRule.createMany).toHaveBeenCalledWith({ data: [30, 7, 0].map((daysBeforeDue) => ({ externalActionId: "action-1", daysBeforeDue })) });
        expect(fake.taskDependency.createMany).toHaveBeenCalledWith({ data: [{ taskId: "task-1", dependsOnId: "dependency-1" }] });
        expect(fake.auditLog.create).toHaveBeenCalledOnce();
    });
});

describe("updateExternalAction — characterization (plan 013)", () => {
    const owner = { id: "owner", role: "MEMBER" as const };
    const current = {
        id: "task-1", type: "EXTERNAL_ACTION", status: "WAITING", projectId: "project-1", caseStudyId: null,
        externalAction: { id: "action-1", ownerId: "owner", externalContactId: "contact", owner: { managerId: null }, reminderRules: [] },
        project: { ownerId: "parent" }, caseStudy: null,
        assignments: [{ userId: "owner" }], tags: [], blockers: [],
    };

    function fakeDb(contactArchived: boolean) {
        const fake = {
            task: { findUnique: vi.fn().mockResolvedValue(current), update: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
            externalContact: { findUnique: vi.fn().mockResolvedValue({ id: "contact", isArchived: contactArchived }) },
            user: { findUnique: vi.fn().mockResolvedValue({ id: "owner", role: "MEMBER", isActive: true, managerId: null }), findMany: vi.fn().mockResolvedValue([{ id: "owner" }]) },
            project: { findUnique: vi.fn().mockResolvedValue({ id: "project-1", ownerId: "parent", workArea: { id: "area", isArchived: false } }) },
            caseStudy: { findUnique: vi.fn() },
            tag: { findMany: vi.fn().mockResolvedValue([]) },
            externalAction: { update: vi.fn() },
            taskAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
            auditLog: { create: vi.fn() },
            $executeRawUnsafe: vi.fn(),
            $transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(fake as never)),
        };
        return fake;
    }

    it("allows editing an action whose contact is archived when the contact is unchanged — fixed by plan 013", async () => {
        const fake = fakeDb(true);
        await expect(updateExternalAction("task-1", { title: "Corrected title" }, owner, fake as never)).resolves.toBeDefined();
    });

    it("acquires an advisory lock while updating the action — fixed by plan 013", async () => {
        const fake = fakeDb(false);
        await updateExternalAction("task-1", { title: "Corrected title" }, owner, fake as never);
        expect(fake.$executeRawUnsafe).toHaveBeenCalled();
    });
});

describe("createExternalAction — parent classification (plan 012)", () => {
    const createInput = {
        title: "T", description: "D", priority: "MEDIUM" as const, ownerId: "owner", externalContactId: "contact",
        dueDate: "2026-08-12", projectId: "project-1", caseStudyId: null, collaboratorIds: [], reminderOffsets: [7],
        overdueIntervalDays: 7, tagIds: [], dependencyIds: [], classifyParentWorkAreaId: "area",
    };

    it("classifies an unclassified parent inside the create transaction", async () => {
        const fake = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: "owner", role: "MEMBER", isActive: true }), findMany: vi.fn().mockResolvedValue([{ id: "owner" }]) },
            externalContact: { findUnique: vi.fn().mockResolvedValue({ id: "contact", isArchived: false }) },
            tag: { findMany: vi.fn().mockResolvedValue([]) },
            project: { findUnique: vi.fn().mockResolvedValue({ id: "project-1", ownerId: "owner", workAreaId: null, members: [], workArea: { id: "area", isArchived: false } }), update: vi.fn() },
            caseStudy: { findUnique: vi.fn() },
            workArea: { findFirst: vi.fn().mockResolvedValue({ id: "area" }) },
            task: { create: vi.fn().mockResolvedValue({ id: "task-1" }), findMany: vi.fn().mockResolvedValue([]) },
            taskDependency: { createMany: vi.fn() },
            externalAction: { create: vi.fn().mockResolvedValue({ id: "action-1" }) },
            reminderRule: { createMany: vi.fn() }, auditLog: { create: vi.fn() },
            $transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(fake as never)),
        };
        await createExternalAction(createInput, { id: "owner", role: "MEMBER" }, fake as never);
        expect(fake.project.update).toHaveBeenCalledWith({ where: { id: "project-1" }, data: { workAreaId: "area" } });
        expect(fake.$transaction).toHaveBeenCalledOnce();
    });

    it("rejects creating under a parent the actor does not own or belong to (plan 016)", async () => {
        const fake = {
            project: { findUnique: vi.fn().mockResolvedValue({ id: "project-1", ownerId: "someone-else", workAreaId: null, members: [] }), update: vi.fn() },
            caseStudy: { findUnique: vi.fn() },
            $transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(fake as never)),
        };
        await expect(createExternalAction(createInput, { id: "not-owner", role: "MEMBER" }, fake as never)).rejects.toThrow();
        expect(fake.project.update).not.toHaveBeenCalled();
    });

    it("allows an admin to create under any parent (plan 016)", async () => {
        const fake = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: "owner", role: "MEMBER", isActive: true }), findMany: vi.fn().mockResolvedValue([{ id: "owner" }]) },
            externalContact: { findUnique: vi.fn().mockResolvedValue({ id: "contact", isArchived: false }) },
            tag: { findMany: vi.fn().mockResolvedValue([]) },
            project: { findUnique: vi.fn().mockResolvedValue({ id: "project-1", ownerId: "someone-else", workAreaId: "area", members: [], workArea: { id: "area", isArchived: false } }), update: vi.fn() },
            caseStudy: { findUnique: vi.fn() },
            workArea: { findFirst: vi.fn().mockResolvedValue({ id: "area" }) },
            task: { create: vi.fn().mockResolvedValue({ id: "task-1" }), findMany: vi.fn().mockResolvedValue([]) },
            taskDependency: { createMany: vi.fn() },
            externalAction: { create: vi.fn().mockResolvedValue({ id: "action-1" }) },
            reminderRule: { createMany: vi.fn() }, auditLog: { create: vi.fn() },
            $transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(fake as never)),
        };
        await expect(createExternalAction({ ...createInput, classifyParentWorkAreaId: null }, { id: "admin-1", role: "ADMIN" }, fake as never)).resolves.toBeDefined();
    });
});
