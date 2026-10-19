import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_PROJECT_STAGES } from "@/lib/project-stages";
import { createProjectSchema, updateProjectSchema, type CreateProjectInput } from "@/lib/projects/schemas";
import { evaluateApproval } from "@/lib/sabah/policy/approval-policy";

vi.mock("@/lib/projects/commands", () => ({
    createProject: vi.fn(),
    updateProject: vi.fn(),
    getProjectForActor: vi.fn(),
    listProjectsForActor: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        projectStage: { count: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
        project: { findUnique: vi.fn() },
        auditLog: { create: vi.fn() },
        $transaction: vi.fn(),
    },
}));

import {
    projectsSearchCapability,
    projectsGetCapability,
    projectsCreateCapability,
    projectsUpdateCapability,
    projectsInitializeStagesCapability,
    projectsGenerateBriefCapability,
    PROJECT_CAPABILITIES,
    registerProjectCapabilities,
    projectCreateItemCount,
} from "./projects";
import { createProject, updateProject, getProjectForActor, listProjectsForActor } from "@/lib/projects/commands";
import { prisma } from "@/lib/prisma";
import { capabilityRegistry } from "../registry";
import type { DuplicateDb, DuplicateRecord } from "@/lib/sabah/intelligence/duplicates";

const memberActor = { id: "actor-1", role: "MEMBER" as const, departmentIds: [] };
const viewerActor = { id: "actor-2", role: "VIEWER" as const, departmentIds: [] };

const baseContext = {
    actor: memberActor,
    requestId: "req-1",
    conversationId: null,
    workflowId: null,
    now: new Date("2026-08-25T00:00:00.000Z"),
    duplicateDb: { scopeDb: { project: { findMany: vi.fn(async () => []) } }, loadCandidates: vi.fn(async () => []) },
};

const validCreateInput = {
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
    memberIds: [],
    objectives: [],
    outputs: [],
    risks: [],
    stages: [],
    metadata: {},
    description: null,
};

function projectDuplicateDb(rows: DuplicateRecord[]): DuplicateDb {
    return {
        scopeDb: { project: { findMany: vi.fn(async () => rows.map((row) => ({ id: row.id, status: "Active", ownerId: null, members: [] }))) } },
        loadCandidates: vi.fn(async () => rows),
    };
}


describe("project capability registration", () => {
    it("exports exactly the six named capabilities", () => {
        const names = PROJECT_CAPABILITIES.map((capability) => capability.name);
        expect(names).toEqual([
            "projects.search",
            "projects.get",
            "projects.create",
            "projects.update",
            "projects.initializeStages",
            "projects.generateBrief",
        ]);
    });

    it("registers without collision into a fresh registry", () => {
        const fresh = { register: vi.fn() } as unknown as typeof capabilityRegistry;
        registerProjectCapabilities(fresh);
        expect(fresh.register).toHaveBeenCalledTimes(6);
    });

    it("has NO delete capability", () => {
        expect(PROJECT_CAPABILITIES.some((capability) => capability.name.includes("delete"))).toBe(false);
    });

    it("keeps create parity with the canonical schema and update parity with its canonical partial", () => {
        expect(projectsCreateCapability.inputSchema).toBe(createProjectSchema);

        const canonicalInvalidUpdate = {
            startAt: "2027-05-01T00:00:00.000Z",
            dueAt: "2027-04-01T00:00:00.000Z",
            stages: [{ name: "Broken", order: 0, status: "NOT_A_STAGE_STATUS" }],
        };
        expect(updateProjectSchema.safeParse(canonicalInvalidUpdate).success).toBe(false);
        expect(
            projectsUpdateCapability.inputSchema.safeParse({
                id: "proj-1",
                expectedUpdatedAt: "2026-08-24T00:00:00.000Z",
                ...canonicalInvalidUpdate,
            }).success,
        ).toBe(false);
    });
});

describe("projects.create", () => {
    beforeEach(() => vi.clearAllMocks());

    it("escalates to REVERSIBLE_WRITE when children are present", () => {
        const risk = projectsCreateCapability.risk as unknown as (this: unknown, input: any, context: any) => string;
        const multi = { ...validCreateInput, objectives: [{ statement: "O", measure: null, target: null, kpiId: null, order: 0 }] };
        expect((risk as any).call(projectsCreateCapability, multi as any, baseContext)).toBe("REVERSIBLE_WRITE");
        expect((risk as any).call(projectsCreateCapability, validCreateInput as any, baseContext)).toBe("DRAFT");
    });

    it("keeps members-only create at lower risk and counts only strategic children", () => {
        const risk = projectsCreateCapability.risk as unknown as (input: any, context: any) => string;
        const membersOnly = { ...validCreateInput, memberIds: ["user-1", "user-2"] };
        expect(projectCreateItemCount(membersOnly as any)).toBe(0);
        expect(risk(membersOnly, baseContext)).toBe("DRAFT");
    });

    it("derives Smart approval item count from strategic child records", () => {
        const risk = projectsCreateCapability.risk as unknown as (input: any, context: any) => string;
        const multi = {
            ...validCreateInput,
            memberIds: ["user-1", "user-2"],
            objectives: [{ statement: "O", measure: null, target: null, kpiId: null, order: 0 }],
            outputs: [{ title: "Output", order: 0 }],
            risks: [],
            stages: [],
        };
        const itemCount = projectCreateItemCount(multi as any);

        expect(itemCount).toBeGreaterThan(1);
        expect(risk(multi, baseContext)).toBe("REVERSIBLE_WRITE");
        expect(
            evaluateApproval({
                mode: "SMART",
                risk: risk(multi, baseContext) as any,
                explicitUserRequest: true,
                hasInferredReplacement: false,
                confidence: 1,
                itemCount,
            }),
        ).toBe("REQUIRE_APPROVAL");
    });

    it("rejects invalid input via Zod", () => {
        const parsed = projectsCreateCapability.inputSchema.safeParse({ ...validCreateInput, name: "" });
        expect(parsed.success).toBe(false);
    });

    it("blocks an exact duplicate during direct execution without optional context keys", async () => {
        const duplicateDb = projectDuplicateDb([{ id: "proj-1", name: "EVP", description: "details", updatedAt: new Date("2026-08-20"), isPrivate: false }]);
        await expect(projectsCreateCapability.authorize({ ...validCreateInput, description: "details" } as any, { ...baseContext, duplicateDb })).rejects.toMatchObject({ code: "DUPLICATE_WORK", status: 409 });
        await expect(projectsCreateCapability.execute({ ...validCreateInput, description: "details" } as any, { ...baseContext, duplicateDb })).rejects.toMatchObject({ code: "DUPLICATE_WORK", status: 409 });
        expect(createProject).not.toHaveBeenCalled();
    });

    it("propagates idempotency keys into direct previews", async () => {
        const lookup = vi.fn(async () => ({ id: "workflow-1", updatedAt: new Date("2026-08-20") }));
        const duplicateDb = { ...projectDuplicateDb([]), findExistingIdempotentWorkflow: lookup };
        const preview = await projectsCreateCapability.preview(validCreateInput as any, { ...baseContext, idempotencyKey: "retry-1", duplicateDb });
        expect(lookup).toHaveBeenCalledWith("retry-1", memberActor.id);
        expect(preview.warnings?.join(" ")).toMatch(/Exact duplicate/i);
    });

    it("preview returns bounded structured duplicate choices without executing create", async () => {
        vi.mocked(createProject).mockClear();
        const preview = await projectsCreateCapability.preview(
            { ...validCreateInput, name: "EVP", description: "different objective", status: "Active" as const, sponsorStatus: "APPROVED" as const, priority: "MEDIUM" as const, health: "NOT_SET" as const } satisfies CreateProjectInput,
            { ...baseContext, duplicateDb: projectDuplicateDb([{ id: "proj-1", name: "EVP", description: "same objective", updatedAt: new Date("2026-08-20"), isPrivate: false }]) },
        );
        expect(preview.warnings?.join(" ")).toMatch(/Likely duplicate/i);
        expect(preview.duplicateChoices?.map((choice) => choice.action)).toEqual(expect.arrayContaining(["USE_EXISTING", "UPDATE_EXISTING", "CREATE_SEPARATELY"]));
        expect(createProject).not.toHaveBeenCalled();
    });

    it("preview lists first-class fields and child counts", async () => {
        const multi = {
            ...validCreateInput,
            objectives: [{ statement: "O1", measure: null, target: null, kpiId: null, order: 0 }],
            outputs: [],
            risks: [],
            stages: [{ name: "Init", order: 0, color: null, startAt: null, dueAt: null, gateCriteria: null, status: "PLANNED" }],
        };
        const preview = await projectsCreateCapability.preview(multi as any, baseContext);
        expect(preview.title).toContain("EVP");
        const paths = preview.fields.map((field) => field.path);
        expect(paths).toContain("name");
        expect(paths).toContain("sponsorStatus");
        expect(preview.fields.some((field) => /1 objective/i.test(String(field.proposed)))).toBe(true);
    });

    it("preview enumerates every canonical project field plus all child counts", async () => {
        const preview = await projectsCreateCapability.preview(validCreateInput as any, baseContext);
        const paths = preview.fields.map((field) => field.path);
        expect(paths).toHaveLength(25);
        expect(paths).toEqual(
            expect.arrayContaining([
                "name",
                "description",
                "status",
                "startAt",
                "dueAt",
                "dueAtEnd",
                "ownerId",
                "managerId",
                "responsibleDepartmentId",
                "sponsorId",
                "sponsorStatus",
                "objective",
                "scope",
                "successCriteria",
                "projectType",
                "priority",
                "health",
                "workAreaId",
                "metadata",
                "memberIds",
                "objectives",
                "outputs",
                "risks",
                "stages",
                "tasks",
            ]),
        );
        expect(preview.fields.find((field) => field.path === "tasks")?.proposed).toBe("0 tasks");
    });

    it("denies VIEWER via available()", async () => {
        await expect(projectsCreateCapability.available(viewerActor)).resolves.toBe(false);
        await expect(projectsCreateCapability.available(memberActor)).resolves.toBe(true);
    });

    it("verify compares material fields on the read-back", async () => {
        (getProjectForActor as any).mockResolvedValue({ id: "proj-1", name: "EVP", status: "Active" });
        const verified = await projectsCreateCapability.verify({ id: "proj-1", name: "EVP", status: "Active" } as any, baseContext);
        expect(verified).toMatchObject({ id: "proj-1" });
    });

    it("fails verification when a material read-back value differs", async () => {
        (getProjectForActor as any).mockResolvedValue({ id: "proj-1", name: "Different", status: "Active" });
        await expect(
            projectsCreateCapability.verify({ id: "proj-1", name: "EVP", status: "Active" } as any, baseContext),
        ).rejects.toMatchObject({ code: "VERIFY_FAILED" });
    });

    it("normalizes Date and ISO values while preserving the reversible marker", async () => {
        (getProjectForActor as any).mockResolvedValue({
            id: "proj-1",
            name: "EVP",
            startAt: "2026-11-01T00:00:00.000Z",
            status: "Active",
        });
        const verified = await projectsCreateCapability.verify(
            {
                id: "proj-1",
                name: "EVP",
                startAt: new Date("2026-11-01T00:00:00.000Z"),
                status: "Active",
                reversible: false,
            } as any,
            baseContext,
        );
        expect(verified).toMatchObject({ id: "proj-1", reversible: false });
    });

    it("fails compensation explicitly without exposing a delete path", async () => {
        await expect(projectsCreateCapability.compensate?.({ id: "proj-1" } as any, baseContext)).rejects.toThrow(
            /no safe compensation/i,
        );
        expect((prisma as any).projectStage.deleteMany).not.toHaveBeenCalled();
    });
});

describe("projects.update", () => {
    beforeEach(() => vi.clearAllMocks());

    it("requires id and expectedUpdatedAt in input", () => {
        expect(projectsUpdateCapability.inputSchema.safeParse({ name: "X" }).success).toBe(false);
        expect(
            projectsUpdateCapability.inputSchema.safeParse({ id: "proj-1", expectedUpdatedAt: "2026-08-24T00:00:00.000Z", name: "X" }).success,
        ).toBe(true);
    });

    it("preview shows current and proposed per changed field", async () => {
        (getProjectForActor as any).mockResolvedValue({ id: "proj-1", name: "Old", status: "Active" });
        const preview = await projectsUpdateCapability.preview(
            { id: "proj-1", expectedUpdatedAt: "2026-08-24T00:00:00.000Z", name: "New" } as any,
            baseContext,
        );
        const nameField = preview.fields.find((field) => field.path === "name");
        expect(nameField?.current).toBe("Old");
        expect(nameField?.proposed).toBe("New");
    });

    it("preview shows current and proposed values for every supplied scalar and replacement set", async () => {
        (getProjectForActor as any).mockResolvedValue({
            id: "proj-1",
            name: "Old",
            description: "Old description",
            status: "Active",
            startAt: new Date("2026-01-01T00:00:00.000Z"),
            dueAt: new Date("2026-02-01T00:00:00.000Z"),
            dueAtEnd: null,
            ownerId: "owner-old",
            managerId: "manager-old",
            responsibleDepartmentId: "dept-old",
            sponsorId: "sponsor-old",
            sponsorStatus: "PENDING",
            objective: "Old objective",
            scope: "Old scope",
            successCriteria: "Old criteria",
            projectType: "Old type",
            priority: "LOW",
            health: "AT_RISK",
            workAreaId: "area-old",
            metadataJson: JSON.stringify({ externalReference: "OLD" }),
            members: [{ userId: "member-old" }],
            objectives: [{ id: "objective-old" }],
            outputs: [{ id: "output-old" }],
            risks: [{ id: "risk-old" }],
            stages: [{ id: "stage-old" }],
        });

        const input = {
            id: "proj-1",
            expectedUpdatedAt: "2026-08-24T00:00:00.000Z",
            name: "New",
            description: "New description",
            status: "Planning",
            startAt: "2026-03-01T00:00:00.000Z",
            dueAt: "2026-04-01T00:00:00.000Z",
            dueAtEnd: "2026-04-30T00:00:00.000Z",
            ownerId: "owner-new",
            managerId: "manager-new",
            responsibleDepartmentId: "dept-new",
            sponsorId: "sponsor-new",
            sponsorStatus: "APPROVED",
            objective: "New objective",
            scope: "New scope",
            successCriteria: "New criteria",
            projectType: "New type",
            priority: "HIGH",
            health: "ON_TRACK",
            workAreaId: "area-new",
            metadata: { externalReference: "NEW" },
            memberIds: ["member-new"],
            objectives: [{ statement: "New objective child", order: 0 }],
            outputs: [{ title: "New output child", order: 0 }],
            risks: [{ title: "New risk child", likelihood: 2, impact: 3 }],
            stages: [{ name: "New stage", order: 0 }],
        };
        const preview = await projectsUpdateCapability.preview(input as any, baseContext);
        const fields = new Map(preview.fields.map((field) => [field.path, field]));
        for (const path of [
            "name",
            "description",
            "status",
            "startAt",
            "dueAt",
            "dueAtEnd",
            "ownerId",
            "managerId",
            "responsibleDepartmentId",
            "sponsorId",
            "sponsorStatus",
            "objective",
            "scope",
            "successCriteria",
            "projectType",
            "priority",
            "health",
            "workAreaId",
            "metadata",
            "memberIds",
            "objectives",
            "outputs",
            "risks",
            "stages",
        ]) {
            expect(fields.get(path)?.current).toBeDefined();
            expect(fields.get(path)?.proposed).toBeDefined();
        }
        expect(fields.get("memberIds")?.proposed).toContain("1 member");
        expect(fields.get("objectives")?.proposed).toContain("1 objective");
        expect(fields.get("outputs")?.current).toContain("1 output");
        expect(fields.get("risks")?.proposed).toContain("1 risk");
        expect(fields.get("stages")?.proposed).toContain("1 stage");
    });

    it("delegates to updateProject command", async () => {
        (updateProject as any).mockResolvedValue({ id: "proj-1", name: "New" });
        const result = await projectsUpdateCapability.execute(
            { id: "proj-1", expectedUpdatedAt: "2026-08-24T00:00:00.000Z", name: "New" } as any,
            baseContext,
        );
        expect(updateProject).toHaveBeenCalledWith("proj-1", expect.objectContaining({ name: "New" }), memberActor, expect.any(Date));
        expect(result).toMatchObject({ id: "proj-1" });
    });

    it("fails verification when the updated material projection does not read back", async () => {
        (getProjectForActor as any).mockResolvedValue({ id: "proj-1", name: "Other", status: "Active" });
        await expect(
            projectsUpdateCapability.verify({ id: "proj-1", name: "New", status: "Active" } as any, baseContext),
        ).rejects.toMatchObject({ code: "VERIFY_FAILED" });
    });

    it("fails compensation explicitly", async () => {
        await expect(projectsUpdateCapability.compensate?.({ id: "proj-1" } as any, baseContext)).rejects.toThrow(
            /no safe compensation/i,
        );
    });
});

describe("read capabilities", () => {
    beforeEach(() => vi.clearAllMocks());

    it("search delegates to listProjectsForActor", async () => {
        (listProjectsForActor as any).mockResolvedValue([]);
        await projectsSearchCapability.execute({ query: "EVP" } as any, baseContext);
        expect(listProjectsForActor).toHaveBeenCalled();
    });

    it("get is available to VIEWER", async () => {
        await expect(projectsGetCapability.available(viewerActor)).resolves.toBe(true);
    });

    it("verifies the full get projection by reading it back", async () => {
        (getProjectForActor as any).mockResolvedValue({ id: "proj-1", name: "Other", status: "Active" });
        await expect(
            projectsGetCapability.verify({ id: "proj-1", name: "EVP", status: "Active" } as any, baseContext),
        ).rejects.toMatchObject({ code: "VERIFY_FAILED" });
        expect(getProjectForActor).toHaveBeenCalledWith("proj-1", memberActor);
    });

    it("brief composes goal/scope/stages from the projection", async () => {
        (getProjectForActor as any).mockResolvedValue({
            id: "proj-1",
            name: "EVP",
            objective: "Enable volunteers",
            scope: "Kingdom-wide",
            successCriteria: "80% satisfaction",
            stages: [{ name: "Initiation", status: "PLANNED" }],
        });
        const brief = await projectsGenerateBriefCapability.execute({ id: "proj-1" } as any, baseContext);
        expect(JSON.stringify(brief)).toContain("Enable volunteers");
        expect(JSON.stringify(brief)).toContain("Initiation");
    });
});

describe("projects.initializeStages", () => {
    beforeEach(() => vi.clearAllMocks());

    it("is a write capability unavailable to VIEWER", async () => {
        await expect(projectsInitializeStagesCapability.available(viewerActor)).resolves.toBe(false);
    });

    it("verifies initialized stage projection through actor-scoped read-back", async () => {
        const stages = [
            { projectId: "proj-1", name: "Plan", order: 0 },
            { projectId: "proj-1", name: "Deliver", order: 1 },
        ];
        (getProjectForActor as any).mockResolvedValue({ id: "proj-1", stages });

        const verified = await projectsInitializeStagesCapability.verify(
            { created: stages.length, projectId: "proj-1", stages, reversible: false } as any,
            baseContext,
        );

        expect(getProjectForActor).toHaveBeenCalledWith("proj-1", memberActor);
        expect(verified).toMatchObject({ created: 2, projectId: "proj-1", reversible: false });
    });

    it("fails stage verification when the actor-scoped read-back projection differs", async () => {
        (getProjectForActor as any).mockResolvedValue({
            id: "proj-1",
            stages: [
                { projectId: "proj-1", name: "Plan", order: 0 },
                { projectId: "proj-1", name: "Wrong", order: 1 },
            ],
        });

        await expect(
            projectsInitializeStagesCapability.verify(
                {
                    created: 2,
                    projectId: "proj-1",
                    stages: [
                        { projectId: "proj-1", name: "Plan", order: 0 },
                        { projectId: "proj-1", name: "Deliver", order: 1 },
                    ],
                } as any,
                baseContext,
            ),
        ).rejects.toMatchObject({ code: "VERIFY_FAILED" });
        expect(getProjectForActor).toHaveBeenCalledWith("proj-1", memberActor);
    });

    it("initializes the five default stages inside a serializable transaction and audits the write", async () => {
        const tx = {
            project: { findUnique: vi.fn().mockResolvedValue({ id: "proj-1" }) },
            projectStage: {
                count: vi.fn().mockResolvedValue(0),
                createMany: vi.fn().mockResolvedValue({ count: DEFAULT_PROJECT_STAGES.length }),
                findMany: vi.fn().mockResolvedValue(DEFAULT_PROJECT_STAGES.map((stage) => ({ ...stage, projectId: "proj-1" }))),
            },
            auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
        };
        (prisma.$transaction as any).mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));

        const result = await projectsInitializeStagesCapability.execute({ id: "proj-1" } as any, baseContext);
        expect(prisma.$transaction).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({ isolationLevel: "Serializable" }),
        );
        expect(tx.project.findUnique).toHaveBeenCalledWith({ where: { id: "proj-1" }, select: { id: true } });
        expect(tx.projectStage.count).toHaveBeenCalledWith({ where: { projectId: "proj-1" } });
        expect(tx.projectStage.createMany).toHaveBeenCalledWith({
            data: DEFAULT_PROJECT_STAGES.map((stage) => ({ ...stage, projectId: "proj-1" })),
        });
        expect(tx.projectStage.findMany).toHaveBeenCalledWith({
            where: { projectId: "proj-1" },
            orderBy: { order: "asc" },
        });
        expect(tx.auditLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ entityId: "proj-1", actorId: memberActor.id }),
            }),
        );
        expect(result).toMatchObject({ created: 5, projectId: "proj-1", reversible: false });
    });

    it("rejects a missing project before stage creation", async () => {
        const tx = {
            project: { findUnique: vi.fn().mockResolvedValue(null) },
            projectStage: { count: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
            auditLog: { create: vi.fn() },
        };
        (prisma.$transaction as any).mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));

        await expect(projectsInitializeStagesCapability.execute({ id: "missing" } as any, baseContext)).rejects.toMatchObject({
            status: 404,
            code: "NOT_FOUND",
        });
        expect(tx.projectStage.count).not.toHaveBeenCalled();
    });

    it("rejects existing stages and never compensates by deleting rows", async () => {
        const tx = {
            project: { findUnique: vi.fn().mockResolvedValue({ id: "proj-1" }) },
            projectStage: { count: vi.fn().mockResolvedValue(1), createMany: vi.fn(), findMany: vi.fn() },
            auditLog: { create: vi.fn() },
        };
        (prisma.$transaction as any).mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));

        await expect(projectsInitializeStagesCapability.execute({ id: "proj-1" } as any, baseContext)).rejects.toMatchObject({
            status: 409,
            code: "STAGES_EXIST",
        });
        expect(tx.projectStage.createMany).not.toHaveBeenCalled();
        await expect(projectsInitializeStagesCapability.compensate?.({ projectId: "proj-1" } as any, baseContext)).rejects.toThrow(
            /no safe compensation/i,
        );
        expect((prisma as any).projectStage.deleteMany).not.toHaveBeenCalled();
    });
});
