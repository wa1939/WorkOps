import { describe, expect, it } from "vitest";
import {
    createProjectSchema,
    projectMetadataSchema,
    sponsorStatusSchema,
    updateProjectSchema,
} from "./schemas";

const validProject = {
    name: "EVP",
    sponsorStatus: "APPROVED",
    startAt: "2026-11-01T00:00:00.000Z",
    dueAt: "2027-04-30T23:59:59.999Z",
    objectives: [],
    outputs: [],
    risks: [],
    stages: [],
    memberIds: [],
};

describe("sponsorStatusSchema", () => {
    it("requires an approved sponsor state from the typed enum", () => {
        expect(
            createProjectSchema.parse({
                name: "EVP",
                sponsorStatus: "APPROVED",
                startAt: "2026-11-01T00:00:00.000Z",
                dueAt: "2027-04-30T23:59:59.999Z",
                objectives: [],
                outputs: [],
                risks: [],
                stages: [],
                memberIds: [],
            }).sponsorStatus,
        ).toBe("APPROVED");
    });

    it("accepts every declared sponsor state and rejects anything else", () => {
        for (const status of ["NOT_REQUIRED", "DRAFT", "PENDING", "APPROVED", "REJECTED"]) {
            expect(sponsorStatusSchema.parse(status)).toBe(status);
        }
        expect(() => sponsorStatusSchema.parse("MAYBE")).toThrow();
    });
});

describe("createProjectSchema", () => {
    it("applies strategic defaults for a minimal payload", () => {
        const parsed = createProjectSchema.parse({ name: "Ops hardening" });
        expect(parsed.sponsorStatus).toBe("NOT_REQUIRED");
        expect(parsed.health).toBe("NOT_SET");
        expect(parsed.priority).toBe("MEDIUM");
        expect(parsed.status).toBe("Active");
        expect(parsed.memberIds).toEqual([]);
        expect(parsed.objectives).toEqual([]);
        expect(parsed.outputs).toEqual([]);
        expect(parsed.risks).toEqual([]);
        expect(parsed.stages).toEqual([]);
        expect(parsed.metadata).toEqual({});
    });

    it("rejects an invalid date order between start and due", () => {
        expect(() =>
            createProjectSchema.parse({
                ...validProject,
                startAt: "2027-05-01T00:00:00.000Z",
                dueAt: "2027-04-30T00:00:00.000Z",
            }),
        ).toThrow(/startAt must be on or before dueAt/);
    });

    it("rejects a dueAt that lands after dueAtEnd", () => {
        expect(() =>
            createProjectSchema.parse({
                ...validProject,
                dueAt: "2027-05-02T00:00:00.000Z",
                dueAtEnd: "2027-05-01T23:59:59.999Z",
            }),
        ).toThrow(/dueAt must be on or before dueAtEnd/);
    });

    it("rejects unsupported metadata keys", () => {
        expect(() =>
            createProjectSchema.parse({
                ...validProject,
                metadata: { externalReference: "EVP-2026", rogueKey: "nope" },
            }),
        ).toThrow();
        expect(() => projectMetadataSchema.parse({ methodology: "Agile" })).not.toThrow();
    });

    it("rejects duplicate order values among objectives", () => {
        expect(() =>
            createProjectSchema.parse({
                ...validProject,
                objectives: [
                    { statement: "Raise retention", order: 0 },
                    { statement: "Cut churn", order: 0 },
                ],
            }),
        ).toThrow(/Duplicate order/);
    });

    it("rejects duplicate order values among outputs and stages", () => {
        expect(() =>
            createProjectSchema.parse({
                ...validProject,
                outputs: [
                    { title: "Report", order: 1 },
                    { title: "Dashboard", order: 1 },
                ],
            }),
        ).toThrow(/Duplicate order/);
        expect(() =>
            createProjectSchema.parse({
                ...validProject,
                stages: [
                    { name: "Discover", order: 2 },
                    { name: "Deliver", order: 2 },
                ],
            }),
        ).toThrow(/Duplicate order/);
    });

    it("rejects a stage whose dates are inverted", () => {
        expect(() =>
            createProjectSchema.parse({
                ...validProject,
                stages: [
                    {
                        name: "Discover",
                        order: 0,
                        startAt: "2027-01-10T00:00:00.000Z",
                        dueAt: "2027-01-01T23:59:59.999Z",
                    },
                ],
            }),
        ).toThrow(/stage startAt must be on or before stage dueAt/);
    });

    it("bounds output acceptance criteria and keeps them optional", () => {
        expect(() =>
            createProjectSchema.parse({
                ...validProject,
                outputs: [{ title: "Report", acceptanceCriteria: "x".repeat(5_001), order: 0 }],
            }),
        ).toThrow();
        const parsed = createProjectSchema.parse({
            ...validProject,
            outputs: [
                { title: "Report", acceptanceCriteria: null, order: 0 },
                { title: "Dashboard", order: 1 },
            ],
        });
        expect(parsed.outputs[0].status).toBe("PLANNED");
        expect(parsed.outputs[1].acceptanceCriteria).toBeUndefined();
    });

    it("bounds risk likelihood and impact to the 1-5 range", () => {
        for (const bad of [{ likelihood: 0, impact: 3 }, { likelihood: 3, impact: 6 }]) {
            expect(() =>
                createProjectSchema.parse({
                    ...validProject,
                    risks: [{ title: "Budget cut", ...bad }],
                }),
            ).toThrow();
        }
        const parsed = createProjectSchema.parse({
            ...validProject,
            risks: [{ title: "Budget cut", likelihood: 1, impact: 5 }],
        });
        expect(parsed.risks[0].status).toBe("OPEN");
    });

    it("accepts nullable optional references everywhere", () => {
        const parsed = createProjectSchema.parse({
            ...validProject,
            ownerId: null,
            managerId: null,
            responsibleDepartmentId: null,
            sponsorId: null,
            workAreaId: null,
            objectives: [{ statement: "Raise retention", measure: null, target: null, kpiId: null, order: 0 }],
        });
        expect(parsed.managerId).toBeNull();
        expect(parsed.objectives[0].kpiId).toBeNull();
    });
});

describe("updateProjectSchema", () => {
    it("accepts an empty partial update", () => {
        expect(updateProjectSchema.parse({})).toEqual({});
    });

    it("applies field-level transforms to supplied fields only", () => {
        const parsed = updateProjectSchema.parse({ name: "  EVP 2027  " });
        expect(parsed.name).toBe("EVP 2027");
        expect(parsed.metadata).toBeUndefined();
    });

    it("still rejects an invalid date order when both dates are supplied", () => {
        expect(() =>
            updateProjectSchema.parse({
                startAt: "2027-05-01T00:00:00.000Z",
                dueAt: "2027-04-01T00:00:00.000Z",
            }),
        ).toThrow(/startAt must be on or before dueAt/);
    });

    it("still rejects duplicate child order values", () => {
        expect(() =>
            updateProjectSchema.parse({
                objectives: [
                    { statement: "A", order: 3 },
                    { statement: "B", order: 3 },
                ],
            }),
        ).toThrow(/Duplicate order/);
    });
});
