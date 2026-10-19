import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    createProject,
    updateProject,
    getProjectForActor,
    listProjectsForActor,
    ProjectCommandError,
} from "./commands";
import type { SabahActor } from "@/lib/sabah/auth/actor";

type MockDb = Record<string, any>;

const memberActor: SabahActor = { id: "actor-1", role: "MEMBER", departmentIds: [] };
const viewerActor: SabahActor = { id: "actor-2", role: "VIEWER", departmentIds: [] };
const adminActor: SabahActor = { id: "actor-3", role: "ADMIN", departmentIds: [] };

const validInput = {
    name: "EVP",
    status: "Active",
    sponsorStatus: "APPROVED",
    startAt: "2026-11-01T00:00:00.000Z",
    dueAt: "2027-04-30T23:59:59.999Z",
    dueAtEnd: null,
    ownerId: null,
    managerId: null,
    responsibleDepartmentId: null,
    sponsorId: null,
    objective: null,
    scope: null,
    successCriteria: null,
    projectType: null,
    priority: "MEDIUM" as const,
    health: "NOT_SET" as const,
    workAreaId: null,
    memberIds: ["user-1"],
    objectives: [{ statement: "Objective A", measure: null, target: null, kpiId: null, order: 0 }],
    outputs: [{ title: "Output A", description: null, acceptanceCriteria: null, ownerId: null, dueAt: null, status: "PLANNED", order: 0 }],
    risks: [],
    stages: [{ name: "Initiation", order: 0, color: null, startAt: null, dueAt: null, gateCriteria: null, status: "PLANNED" }],
    metadata: {},
    description: null,
};

function makeDb(): MockDb {
    const db: MockDb = {
        $transaction: vi.fn(),
        user: { findMany: vi.fn().mockImplementation(async ({ where }: any) => (where.id?.in ?? []).map((id: string) => ({ id }))) },
        department: { findMany: vi.fn() },
        workArea: { findFirst: vi.fn() },
        kPI: { findMany: vi.fn().mockImplementation(async ({ where }: any) => (where.id?.in ?? []).map((id: string) => ({ id }))) },
        project: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
            findMany: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
        },
        projectMember: { createMany: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
        projectObjective: { createMany: vi.fn(), deleteMany: vi.fn() },
        projectOutput: { createMany: vi.fn(), deleteMany: vi.fn() },
        projectRisk: { createMany: vi.fn(), deleteMany: vi.fn() },
        projectStage: { createMany: vi.fn(), deleteMany: vi.fn() },
        task: { count: vi.fn().mockResolvedValue(0) },
        auditLog: { create: vi.fn() },
    };
    return db;
}

function validRefCheckSetup(db: MockDb) {
    // Echo back every queried id as a valid row — "all references resolve".
    db.department.findMany.mockResolvedValue([]);
    db.workArea.findFirst.mockResolvedValue({ id: "wa-1" });
    db.$transaction.mockImplementation(async (fn: any) => fn(db));
}

const fullInclude = expect.anything();

describe("createProject", () => {
    let db: MockDb;
    beforeEach(() => {
        db = makeDb();
        validRefCheckSetup(db);
        db.project.create.mockImplementation(async ({ data }: any) => ({
            id: "proj-1",
            ...data,
            updatedAt: new Date("2026-08-25T00:00:00.000Z"),
        }));
        db.project.findUnique.mockResolvedValue({ id: "proj-1", name: "EVP", members: [], objectives: [] });
    });

    it("permits an active MEMBER and defaults owner/manager to the actor when omitted", async () => {
        const input = { ...validInput, ownerId: undefined, managerId: undefined };
        await createProject(input as any, memberActor, db as any);
        const createCall = db.project.create.mock.calls[0][0];
        expect(createCall.data.ownerId).toBe(memberActor.id);
        expect(createCall.data.managerId).toBe(memberActor.id);
    });

    it("denies VIEWER", async () => {
        await expect(createProject(validInput as any, viewerActor, db as any)).rejects.toMatchObject({
            status: 403,
        });
        expect(db.project.create).not.toHaveBeenCalled();
    });

    it("rejects inactive work area", async () => {
        db.workArea.findFirst.mockResolvedValue(null);
        await expect(
            createProject({ ...validInput, workAreaId: "wa-x" } as any, memberActor, db as any),
        ).rejects.toMatchObject({ status: 400, code: "INVALID_REFERENCE" });
    });

    it("rejects unknown member user ids", async () => {
        db.user.findMany.mockResolvedValue([]); // nothing resolves → all referenced users invalid
        await expect(createProject(validInput as any, memberActor, db as any)).rejects.toMatchObject({
            status: 400,
            code: "INVALID_REFERENCE",
        });
    });

    it("rolls back everything when a child insert fails", async () => {
        db.projectOutput.createMany.mockRejectedValue(new Error("foreign key"));
        await expect(createProject(validInput as any, memberActor, db as any)).rejects.toThrow();
        expect(db.$transaction).toHaveBeenCalledOnce();
    });

    it("writes an audit log entry with changed field names", async () => {
        await createProject(validInput as any, memberActor, db as any);
        expect(db.auditLog.create).toHaveBeenCalled();
        const entry = db.auditLog.create.mock.calls[0][0].data;
        expect(entry.action).toBe("created");
        expect(Array.isArray(JSON.parse(entry.metaJson).fields)).toBe(true);
    });

    it("returns the read-back projection", async () => {
        db.project.findUnique.mockResolvedValue({ id: "proj-1", name: "EVP", readBack: true });
        const result = await createProject(validInput as any, memberActor, db as any);
        expect(result).toMatchObject({ id: "proj-1", readBack: true });
        expect(db.project.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "proj-1" } }),
        );
    });

    it("persists stages in the create transaction with mapped fields", async () => {
        await createProject(validInput as any, memberActor, db as any);
        expect(db.projectStage.deleteMany).toHaveBeenCalledWith({ where: { projectId: "proj-1" } });
        expect(db.projectStage.createMany).toHaveBeenCalledWith({
            data: [
                {
                    projectId: "proj-1",
                    name: "Initiation",
                    order: 0,
                    color: null,
                    startAt: null,
                    dueAt: null,
                    gateCriteria: null,
                    status: "PLANNED",
                },
            ],
        });
    });

    it("persists stage dates as Date objects", async () => {
        const input = {
            ...validInput,
            stages: [
                {
                    name: "Delivery",
                    order: 1,
                    color: "#7c3aed",
                    startAt: "2026-11-01T00:00:00.000Z",
                    dueAt: "2026-12-01T00:00:00.000Z",
                    gateCriteria: "Sign-off",
                    status: "ACTIVE" as const,
                },
            ],
        };
        await createProject(input as any, memberActor, db as any);
        expect(db.projectStage.createMany).toHaveBeenCalledWith({
            data: [
                {
                    projectId: "proj-1",
                    name: "Delivery",
                    order: 1,
                    color: "#7c3aed",
                    startAt: new Date("2026-11-01T00:00:00.000Z"),
                    dueAt: new Date("2026-12-01T00:00:00.000Z"),
                    gateCriteria: "Sign-off",
                    status: "ACTIVE",
                },
            ],
        });
    });

    it("keeps an explicit ownerId null instead of coercing to the actor", async () => {
        const input = { ...validInput, ownerId: null, managerId: undefined };
        await createProject(input as any, memberActor, db as any);
        const createCall = db.project.create.mock.calls[0][0];
        expect(createCall.data.ownerId).toBeNull();
        expect(createCall.data.managerId).toBe(memberActor.id);
    });
});

describe("updateProject", () => {
    let db: MockDb;
    beforeEach(() => {
        db = makeDb();
        validRefCheckSetup(db);
        db.project.findUnique.mockResolvedValue({
            id: "proj-1",
            ownerId: memberActor.id,
            updatedAt: new Date("2026-08-24T00:00:00.000Z"),
        });
        db.project.update.mockImplementation(async ({ data }: any) => ({
            id: "proj-1",
            ...data,
            updatedAt: new Date("2026-08-25T00:00:00.000Z"),
        }));
        db.$transaction.mockImplementation(async (fn: any) => fn(db));
    });

    it("rejects version conflict when expectedUpdatedAt mismatches", async () => {
        await expect(
            updateProject("proj-1", { name: "New" } as any, memberActor, new Date("2026-08-23T00:00:00.000Z"), db as any),
        ).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
        expect(db.project.update).not.toHaveBeenCalled();
    });

    it("permits the owner", async () => {
        await updateProject("proj-1", { name: "New" } as any, memberActor, new Date("2026-08-24T00:00:00.000Z"), db as any);
        expect(db.project.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "proj-1", updatedAt: new Date("2026-08-24T00:00:00.000Z") },
        }));
    });

    it("maps a lost transactional version claim to VERSION_CONFLICT before child writes", async () => {
        db.project.update.mockRejectedValueOnce(Object.assign(new Error("record not found"), { code: "P2025" }));

        await expect(
            updateProject("proj-1", { objectives: [{ statement: "O2", measure: null, target: null, kpiId: null, order: 0 }] } as any, memberActor, new Date("2026-08-24T00:00:00.000Z"), db as any),
        ).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
        expect(db.projectObjective.deleteMany).not.toHaveBeenCalled();
    });

    it("permits ADMIN even when not owner", async () => {
        await updateProject("proj-1", { name: "New" } as any, adminActor, new Date("2026-08-24T00:00:00.000Z"), db as any);
        expect(db.project.update).toHaveBeenCalled();
    });

    it("denies a non-owner non-member", async () => {
        db.projectMember.findMany = vi.fn().mockResolvedValue([]);
        db.project.findUnique.mockResolvedValue({
            id: "proj-1",
            ownerId: "someone-else",
            updatedAt: new Date("2026-08-24T00:00:00.000Z"),
        });
        await expect(
            updateProject("proj-1", { name: "New" } as any, viewerActor, new Date("2026-08-24T00:00:00.000Z"), db as any),
        ).rejects.toMatchObject({ status: 403 });
    });

    it("replaces children transactionally on update", async () => {
        await updateProject(
            "proj-1",
            { objectives: [{ statement: "O2", measure: null, target: null, kpiId: null, order: 0 }] } as any,
            memberActor,
            new Date("2026-08-24T00:00:00.000Z"),
            db as any,
        );
        expect(db.projectObjective.deleteMany).toHaveBeenCalledWith({ where: { projectId: "proj-1" } });
        expect(db.projectObjective.createMany).toHaveBeenCalled();
    });

    it("replace-sets stages on update with mapped fields", async () => {
        await updateProject(
            "proj-1",
            {
                stages: [
                    {
                        name: "Planning",
                        order: 0,
                        color: "purple",
                        startAt: "2026-11-01T00:00:00.000Z",
                        dueAt: null,
                        gateCriteria: null,
                        status: "ACTIVE",
                    },
                    { name: "Closed", order: 1, color: null, startAt: null, dueAt: null, gateCriteria: "Done", status: "COMPLETE" },
                ],
            } as any,
            memberActor,
            new Date("2026-08-24T00:00:00.000Z"),
            db as any,
        );
        expect(db.projectStage.deleteMany).toHaveBeenCalledWith({ where: { projectId: "proj-1" } });
        expect(db.projectStage.createMany).toHaveBeenCalledTimes(1);
        expect(db.projectStage.createMany).toHaveBeenCalledWith({
            data: [
                {
                    projectId: "proj-1",
                    name: "Planning",
                    order: 0,
                    color: "purple",
                    startAt: new Date("2026-11-01T00:00:00.000Z"),
                    dueAt: null,
                    gateCriteria: null,
                    status: "ACTIVE",
                },
                {
                    projectId: "proj-1",
                    name: "Closed",
                    order: 1,
                    color: null,
                    startAt: null,
                    dueAt: null,
                    gateCriteria: "Done",
                    status: "COMPLETE",
                },
            ],
        });
    });

    it("rejects clearing a work area with live external actions (409 WORK_AREA_REQUIRED)", async () => {
        db.task.count.mockResolvedValue(3);
        await expect(
            updateProject(
                "proj-1",
                { workAreaId: null } as any,
                memberActor,
                new Date("2026-08-24T00:00:00.000Z"),
                db as any,
            ),
        ).rejects.toMatchObject({
            status: 409,
            code: "WORK_AREA_REQUIRED",
            message: "Move or remove external actions before clearing the work area",
        });
        expect(db.task.count).toHaveBeenCalledWith({
            where: { projectId: "proj-1", type: "EXTERNAL_ACTION" },
        });
        expect(db.project.update).not.toHaveBeenCalled();
    });

    it("allows clearing a work area with no external actions", async () => {
        db.task.count.mockResolvedValue(0);
        await updateProject(
            "proj-1",
            { workAreaId: null } as any,
            memberActor,
            new Date("2026-08-24T00:00:00.000Z"),
            db as any,
        );
        expect(db.project.update).toHaveBeenCalled();
    });

    it("checks permission before version (non-owner + stale version → 403 not 409)", async () => {
        db.project.findUnique.mockResolvedValue({
            id: "proj-1",
            ownerId: "someone-else",
            managerId: null,
            updatedAt: new Date("2026-08-24T00:00:00.000Z"),
        });
        await expect(
            updateProject(
                "proj-1",
                { name: "New" } as any,
                memberActor,
                new Date("2026-08-23T00:00:00.000Z"), // stale → would be 409 if version ran first
                db as any,
            ),
        ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
        expect(db.project.update).not.toHaveBeenCalled();
    });

    it("rejects invalid outputs[].ownerId with 400 INVALID_REFERENCE", async () => {
        db.user.findMany.mockResolvedValue([]); // no user resolves → ownerId invalid
        await expect(
            updateProject(
                "proj-1",
                { outputs: [{ title: "Output X", ownerId: "user-dead", status: "PLANNED", order: 0 }] } as any,
                memberActor,
                new Date("2026-08-24T00:00:00.000Z"),
                db as any,
            ),
        ).rejects.toMatchObject({ status: 400, code: "INVALID_REFERENCE" });
        expect(db.projectOutput.createMany).not.toHaveBeenCalled();
    });

    it("404s for a missing project", async () => {
        db.project.findUnique.mockResolvedValue(null);
        await expect(
            updateProject("nope", { name: "New" } as any, memberActor, new Date("2026-08-24T00:00:00.000Z"), db as any),
        ).rejects.toMatchObject({ status: 404 });
    });
});

describe("getProjectForActor / listProjectsForActor", () => {
    let db: MockDb;
    beforeEach(() => {
        db = makeDb();
    });

    it("reads with the full projection include", async () => {
        db.project.findFirst.mockResolvedValue({ id: "proj-1" });
        await getProjectForActor("proj-1", memberActor, db as any);
        expect(db.project.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ id: "proj-1" }) }),
        );
    });

    it("returns null for missing project", async () => {
        db.project.findFirst.mockResolvedValue(null);
        const result = await getProjectForActor("nope", memberActor, db as any);
        expect(result).toBeNull();
    });

    it("lists ordered by updatedAt desc", async () => {
        db.project.findMany.mockResolvedValue([]);
        await listProjectsForActor({}, memberActor, db as any);
        expect(db.project.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ orderBy: { updatedAt: "desc" } }),
        );
    });
});

describe("ProjectCommandError", () => {
    it("carries status and code", () => {
        const error = new ProjectCommandError("nope", 404, "NOT_FOUND");
        expect(error.status).toBe(404);
        expect(error.code).toBe("NOT_FOUND");
    });
});
