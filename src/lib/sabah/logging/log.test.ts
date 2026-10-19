import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { writeOperationalLog, writeActivityEvent, writeCapabilityAudit } from "./log";

type MockDb = Pick<PrismaClient, "aiOperationalLog" | "aiWorkflowEvent">;

const createMockDb = (): MockDb => ({
    aiOperationalLog: {
        create: vi.fn(),
    } as unknown as MockDb["aiOperationalLog"],
    aiWorkflowEvent: {
        create: vi.fn(),
    } as unknown as MockDb["aiWorkflowEvent"],
});

describe("writeOperationalLog", () => {
    let mockDb: MockDb;

    beforeEach(() => {
        mockDb = createMockDb();
        vi.clearAllMocks();
    });

    it("writes operational log with redacted metadata", async () => {
        const event = {
            level: "INFO" as const,
            category: "CAPABILITY" as const,
            message: "Executing capability",
            correlationId: "corr-123",
            workflowId: "workflow-456",
            stepId: "step-789",
            actorId: "actor-001",
            metadata: {
                apiKey: "secret",
                data: "x".repeat(2000),
            },
            expiresAt: new Date("2024-12-31"),
        };

        await writeOperationalLog(event, mockDb);

        expect(mockDb.aiOperationalLog.create).toHaveBeenCalledWith({
            data: {
                workflowId: "workflow-456",
                category: "CAPABILITY",
                level: "INFO",
                message: "Executing capability",
                correlationId: "corr-123",
                metadataJson: expect.stringContaining("[REDACTED]"),
                expiresAt: new Date("2024-12-31"),
            },
        });
    });

    it("handles optional fields correctly", async () => {
        const event = {
            level: "DEBUG" as const,
            category: "RETRIEVAL" as const,
            message: "Fetching data",
            correlationId: "corr-456",
            expiresAt: new Date("2024-12-31"),
        };

        await writeOperationalLog(event, mockDb);

        expect(mockDb.aiOperationalLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                category: "RETRIEVAL",
                level: "DEBUG",
                message: "Fetching data",
                correlationId: "corr-456",
                metadataJson: null,
            }),
        });
    });

    it("persists correlationId from event", async () => {
        const event = {
            level: "INFO" as const,
            category: "CAPABILITY" as const,
            message: "Test correlation persistence",
            correlationId: "corr-test-xyz",
            workflowId: "workflow-test",
            expiresAt: new Date("2024-12-31"),
        };

        await writeOperationalLog(event, mockDb);

        expect(mockDb.aiOperationalLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                workflowId: "workflow-test",
                category: "CAPABILITY",
                level: "INFO",
                message: "Test correlation persistence",
                correlationId: "corr-test-xyz",
            }),
        });
    });
});

describe("writeActivityEvent", () => {
    let mockDb: MockDb;

    beforeEach(() => {
        mockDb = createMockDb();
        vi.clearAllMocks();
    });

    it("writes activity event to AiWorkflowEvent", async () => {
        const event = {
            level: "INFO" as const,
            category: "CAPABILITY" as const,
            message: "User approved step",
            correlationId: "corr-789",
            workflowId: "workflow-123",
            stepId: "step-456",
            conversationId: "conv-abc",
            actorId: "actor-002",
            expiresAt: new Date("2024-12-31"),
        };

        await writeActivityEvent(event, mockDb);

        expect(mockDb.aiWorkflowEvent.create).toHaveBeenCalledWith({
            data: {
                workflowId: "workflow-123",
                stepId: "step-456",
                eventType: "USER_ACTIVITY",
                level: "INFO",
                message: "User approved step",
                metadataJson: expect.any(String),
            },
        });
    });
});

describe("writeCapabilityAudit", () => {
    let mockDb: MockDb;

    beforeEach(() => {
        mockDb = createMockDb();
        vi.clearAllMocks();
    });

    it("writes capability audit to AiWorkflowEvent with actor/action/entity/diff", async () => {
        const event = {
            level: "SECURITY" as const,
            category: "SECURITY" as const,
            message: "Capability executed with approval",
            correlationId: "corr-audit-123",
            workflowId: "workflow-audit-456",
            stepId: "step-audit-789",
            actorId: "actor-audit-001",
            metadata: {
                action: "projects.create",
                entity: "Task",
                diff: { before: {}, after: { title: "New Task" } },
                approval: true,
                verification: "verified",
                undo: true,
            },
            expiresAt: new Date("2024-12-31"),
        };

        await writeCapabilityAudit(event, mockDb);

        expect(mockDb.aiWorkflowEvent.create).toHaveBeenCalledWith({
            data: {
                workflowId: "workflow-audit-456",
                stepId: "step-audit-789",
                eventType: "CAPABILITY_AUDIT",
                level: "SECURITY",
                message: "Capability executed with approval",
                metadataJson: expect.stringContaining("projects.create"),
            },
        });
    });
});
