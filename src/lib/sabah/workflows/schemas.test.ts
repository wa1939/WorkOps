import { describe, it, expect } from "vitest";
import {
    proposedWorkflowStepSchema,
    proposedWorkflowSchema,
    approvalPreviewSchema,
    clarificationRequestSchema,
    workflowDecisionSchema,
    workflowSnapshotSchema,
} from "./schemas";

describe("ProposedWorkflowStep schema", () => {
    it("rejects duplicate client step ids and unknown dependencies", () => {
        expect(() =>
            proposedWorkflowSchema.parse({
                goal: "Create project",
                steps: [
                    {
                        clientStepId: "a",
                        capability: "projects.create",
                        args: {},
                        dependsOn: ["missing"],
                        confidence: 1,
                        evidenceRefs: [],
                    },
                    {
                        clientStepId: "a",
                        capability: "tasks.create",
                        args: {},
                        dependsOn: [],
                        confidence: 1,
                        evidenceRefs: [],
                    },
                ],
            })
        ).toThrow();
    });

    it("rejects circular dependencies", () => {
        expect(() =>
            proposedWorkflowSchema.parse({
                goal: "Circular workflow",
                steps: [
                    {
                        clientStepId: "step1",
                        capability: "projects.create",
                        args: {},
                        dependsOn: ["step3"],
                        confidence: 0.9,
                        evidenceRefs: [],
                    },
                    {
                        clientStepId: "step2",
                        capability: "tasks.create",
                        args: {},
                        dependsOn: ["step1"],
                        confidence: 0.9,
                        evidenceRefs: [],
                    },
                    {
                        clientStepId: "step3",
                        capability: "projects.update",
                        args: {},
                        dependsOn: ["step2"],
                        confidence: 0.9,
                        evidenceRefs: [],
                    },
                ],
            })
        ).toThrow();
    });

    it("accepts valid step with all optional fields", () => {
        expect(() =>
            proposedWorkflowStepSchema.parse({
                clientStepId: "valid-step",
                capability: "projects.create",
                version: 1,
                args: { name: "Test" },
                dependsOn: [],
                confidence: 0.95,
                inferredFields: ["departmentId"],
                evidenceRefs: ["ref-1"],
            })
        ).not.toThrow();
    });

    it("accepts valid minimal step", () => {
        expect(() =>
            proposedWorkflowStepSchema.parse({
                clientStepId: "minimal",
                capability: "tasks.create",
                args: {},
                dependsOn: [],
                confidence: 0.8,
            })
        ).not.toThrow();
    });

    it("rejects invalid capability name format", () => {
        expect(() =>
            proposedWorkflowStepSchema.parse({
                clientStepId: "bad-cap",
                capability: "InvalidCapability",
                args: {},
                dependsOn: [],
                confidence: 0.8,
            })
        ).toThrow();
    });

    it("rejects confidence outside 0-1 range", () => {
        expect(() =>
            proposedWorkflowStepSchema.parse({
                clientStepId: "bad-conf",
                capability: "projects.create",
                args: {},
                dependsOn: [],
                confidence: 1.5,
            })
        ).toThrow();
    });
});

describe("ProposedWorkflow schema", () => {
    it("accepts valid workflow with dependencies", () => {
        expect(() =>
            proposedWorkflowSchema.parse({
                goal: "Create project and tasks",
                steps: [
                    {
                        clientStepId: "step1",
                        capability: "projects.create",
                        args: {},
                        dependsOn: [],
                        confidence: 0.95,
                        evidenceRefs: [],
                    },
                    {
                        clientStepId: "step2",
                        capability: "tasks.create",
                        args: {},
                        dependsOn: ["step1"],
                        confidence: 0.9,
                        evidenceRefs: [],
                    },
                ],
            })
        ).not.toThrow();
    });

    it("accepts valid minimal workflow", () => {
        expect(() =>
            proposedWorkflowSchema.parse({
                goal: "Single step workflow",
                steps: [
                    {
                        clientStepId: "s1",
                        capability: "projects.create",
                        args: {},
                        dependsOn: [],
                        confidence: 0.85,
                        evidenceRefs: [],
                    },
                ],
            })
        ).not.toThrow();
    });

    it("rejects empty steps array", () => {
        expect(() =>
            proposedWorkflowSchema.parse({
                goal: "Empty workflow",
                steps: [],
            })
        ).toThrow();
    });

    it("rejects missing goal", () => {
        expect(() =>
            proposedWorkflowSchema.parse({
                steps: [
                    {
                        clientStepId: "s1",
                        capability: "projects.create",
                        args: {},
                        dependsOn: [],
                        confidence: 0.8,
                        evidenceRefs: [],
                    },
                ],
            })
        ).toThrow();
    });
});

describe("ApprovalPreview schema", () => {
    it("accepts valid approval preview", () => {
        expect(() =>
            approvalPreviewSchema.parse({
                id: "cltest123abc",
                workflowId: "clworkflow456",
                stepIds: ["clstep789"],
                title: "Create new project",
                summary: "Will create a project with 5 initial tasks",
                risk: "REVERSIBLE_WRITE",
                fields: [
                    {
                        path: "name",
                        current: undefined,
                        proposed: "Test Project",
                    },
                ],
                warnings: ["This will create audit logs"],
                expiresAt: "2026-08-25T12:00:00Z",
            })
        ).not.toThrow();
    });

    it("accepts minimal approval preview", () => {
        expect(() =>
            approvalPreviewSchema.parse({
                id: "clmin123abc456def789",
                workflowId: "clmin456def789abc123",
                stepIds: ["clstep1abc456def789ghi"],
                title: "Minimal approval",
                summary: "Summary",
                risk: "SENSITIVE_WRITE",
                fields: [],
                expiresAt: "2026-12-31T23:59:59Z",
            })
        ).not.toThrow();
    });

    it("rejects invalid risk value", () => {
        expect(() =>
            approvalPreviewSchema.parse({
                id: "clbad123",
                workflowId: "clbad456",
                stepIds: ["clstep1"],
                title: "Bad risk",
                summary: "Summary",
                risk: "INVALID_RISK" as any,
                fields: [],
                expiresAt: "2026-12-31T23:59:59Z",
            })
        ).toThrow();
    });

    it("rejects empty stepIds", () => {
        expect(() =>
            approvalPreviewSchema.parse({
                id: "clempty123",
                workflowId: "clempty456",
                stepIds: [],
                title: "Empty steps",
                summary: "Summary",
                risk: "BULK_WRITE",
                fields: [],
                expiresAt: "2026-12-31T23:59:59Z",
            })
        ).toThrow();
    });

    it("rejects too many fields", () => {
        const fields = Array.from({ length: 201 }, (_, i) => ({
            path: `field${i}`,
            current: undefined,
            proposed: `value${i}`,
        }));

        expect(() =>
            approvalPreviewSchema.parse({
                id: "cltoomany123",
                workflowId: "cltoomany456",
                stepIds: ["clstep1"],
                title: "Too many fields",
                summary: "Summary",
                risk: "REVERSIBLE_WRITE",
                fields,
                expiresAt: "2026-12-31T23:59:59Z",
            })
        ).toThrow();
    });
});

describe("ClarificationRequest schema", () => {
    it("accepts valid clarification request", () => {
        expect(() =>
            clarificationRequestSchema.parse({
                id: "clclar123",
                question: "Which department should own this project?",
                choices: [
                    { id: "dept-a", label: "Department A" },
                    { id: "dept-b", label: "Department B" },
                ],
                multiSelect: false,
                allowFreeText: true,
            })
        ).not.toThrow();
    });

    it("accepts minimal clarification request", () => {
        expect(() =>
            clarificationRequestSchema.parse({
                id: "clminclar123",
                question: "What is your preference?",
            })
        ).not.toThrow();
    });

    it("rejects empty question", () => {
        expect(() =>
            clarificationRequestSchema.parse({
                id: "clempty123",
                question: "",
            })
        ).toThrow();
    });

    it("rejects too many choices", () => {
        expect(() =>
            clarificationRequestSchema.parse({
                id: "cltoomany123",
                question: "Select one",
                choices: Array.from({ length: 5 }, (_, i) => ({
                    id: `choice${i}`,
                    label: `Choice ${i}`,
                })),
            })
        ).toThrow();
    });
});

describe("WorkflowDecision schema", () => {
    it("rejects an approval decision for the wrong approval id", () => {
        expect(() =>
            workflowDecisionSchema.parse({
                type: "APPROVE",
                approvalId: "",
                reason: null,
            })
        ).toThrow();
    });

    it("accepts valid APPROVE decision", () => {
        expect(() =>
            workflowDecisionSchema.parse({
                type: "APPROVE",
                approvalId: "clapprov123",
                reason: "Looks good",
            })
        ).not.toThrow();
    });

    it("accepts valid REJECT decision", () => {
        expect(() =>
            workflowDecisionSchema.parse({
                type: "REJECT",
                approvalId: "clreject123",
                reason: "Not enough context",
            })
        ).not.toThrow();
    });

    it("accepts valid RENEW decision", () => {
        expect(() =>
            workflowDecisionSchema.parse({
                type: "RENEW",
                approvalId: "clrenew123",
                reason: "Approval window elapsed",
            })
        ).not.toThrow();
    });

    it("accepts valid CLARIFY decision", () => {
        expect(() =>
            workflowDecisionSchema.parse({
                type: "CLARIFY",
                clarificationId: "clclar123",
                choiceIds: ["choice-a"],
                freeText: "Some additional context",
            })
        ).not.toThrow();
    });

    it("accepts valid RESOLVE_DUPLICATE decision", () => {
        expect(() =>
            workflowDecisionSchema.parse({
                type: "RESOLVE_DUPLICATE",
                stepId: "clstep123",
                resolution: "USE_EXISTING",
                entityId: "clentity456",
                reason: "Already exists",
            })
        ).not.toThrow();
    });

    it("rejects invalid decision type", () => {
        expect(() =>
            workflowDecisionSchema.parse({
                type: "INVALID" as any,
                approvalId: "cltest123",
            })
        ).toThrow();
    });

    it("rejects missing reason for REJECT", () => {
        expect(() =>
            workflowDecisionSchema.parse({
                type: "REJECT",
                approvalId: "clreject123",
                reason: "" as any,
            })
        ).toThrow();
    });
});

describe("WorkflowSnapshot schema", () => {
    it("accepts valid workflow snapshot", () => {
        expect(() =>
            workflowSnapshotSchema.parse({
                id: "clsnap123abc456def789",
                goal: "Create project",
                status: "RUNNING",
                steps: [
                    {
                        id: "clstep1abc456def789ghi",
                        clientStepId: "s1",
                        capability: "projects.create",
                        status: "VERIFIED",
                        dependsOn: [],
                        confidence: 0.95,
                    },
                ],
                approvals: [],
                createdAt: "2026-08-24T10:00:00Z",
                updatedAt: "2026-08-24T10:05:00Z",
            })
        ).not.toThrow();
    });

    it("accepts minimal workflow snapshot", () => {
        expect(() =>
            workflowSnapshotSchema.parse({
                id: "clmin123abc456def789",
                goal: "Minimal",
                status: "PLANNED",
                steps: [],
                approvals: [],
                createdAt: "2026-08-24T00:00:00Z",
                updatedAt: "2026-08-24T00:00:00Z",
            })
        ).not.toThrow();
    });

    it("rejects invalid status value", () => {
        expect(() =>
            workflowSnapshotSchema.parse({
                id: "clbad123",
                goal: "Bad status",
                status: "INVALID_STATUS" as any,
                steps: [],
                approvals: [],
                createdAt: "2026-08-24T00:00:00Z",
                updatedAt: "2026-08-24T00:00:00Z",
            })
        ).toThrow();
    });

    it("rejects missing required fields", () => {
        expect(() =>
            workflowSnapshotSchema.parse({
                id: "clmissing123",
                goal: "Missing fields",
                // Missing status, steps, approvals, createdAt, updatedAt
            } as any)
        ).toThrow();
    });

    it("accepts verified internal links and preserves the legacy HTTPS form", () => {
        const snapshot = {
            id: "clsnaplinks123abc456def",
            goal: "Open task links",
            status: "COMPLETED",
            steps: [
                {
                    id: "clstep-links123abc456",
                    clientStepId: "s1",
                    capability: "tasks.create",
                    status: "VERIFIED",
                    dependsOn: [],
                    confidence: 1,
                    entityLinks: [
                        { type: "TASK", id: "t1", href: "/tasks/t1", label: "Task 1" },
                        { type: "TASK", id: "t2", href: "https://example.test/tasks/t2", label: "Task 2" },
                    ],
                },
            ],
            approvals: [],
            createdAt: "2026-10-08T00:00:00Z",
            updatedAt: "2026-10-08T00:00:00Z",
        };

        expect(workflowSnapshotSchema.safeParse(snapshot).success).toBe(true);
    });

    it("rejects protocol-relative, script, backslash, and control-character links", () => {
        const base = {
            id: "clsnapunsafe123abc456",
            goal: "Reject unsafe links",
            status: "COMPLETED" as const,
            steps: [
                {
                    id: "clstep-unsafe123abc456",
                    clientStepId: "s1",
                    capability: "tasks.create",
                    status: "VERIFIED" as const,
                    dependsOn: [],
                    confidence: 1,
                    entityLinks: [],
                },
            ],
            approvals: [],
            createdAt: "2026-10-08T00:00:00Z",
            updatedAt: "2026-10-08T00:00:00Z",
        };

        for (const href of ["//evil.example", "javascript:alert(1)", "/tasks/\\\\evil", `/tasks/${String.fromCharCode(7)}evil`]) {
            const snapshot = {
                ...base,
                steps: [{ ...base.steps[0], entityLinks: [{ type: "TASK", id: "t1", href, label: "Unsafe" }] }],
            };
            expect(workflowSnapshotSchema.safeParse(snapshot).success, href).toBe(false);
        }
    });
});