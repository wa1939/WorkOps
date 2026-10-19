import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { previewCapability, runCapability, compensateCapability } from "./runner";
import { capabilityRegistry } from "./registry";
import type { SabahCapability, CapabilityContext, SabahActor } from "./contracts";
import type { RunnerDeps } from "./runner";
import { evaluateApproval } from "../policy/approval-policy";
import { writeOperationalLog, writeActivityEvent, writeCapabilityAudit } from "../logging/log";
import { getSabahFlags } from "../flags";
import { LifecycleEventBus } from "../events/bus";


// Result states per brief
type CapabilityRunResult = {
    state: "ALLOWED_PREVIEW" | "APPROVAL_REQUIRED" | "BLOCKED" | "DISABLED" | "VERIFIED" | "FAILED" | "FAILED_VERIFICATION";
    output?: unknown;
    preview?: unknown;
    error?: string;
};

// Fake capability helpers
function createFakeCapability(): SabahCapability<{ id: string }, { created: string }> {
    return {
        name: "test-capability",
        version: 1,
        module: "test",
        description: "A test capability",
        risk: "REVERSIBLE_WRITE",
        inputSchema: z.object({ id: z.string() }),
        outputSchema: z.object({ created: z.string() }),
        available: vi.fn().mockResolvedValue(true),
        authorize: vi.fn().mockResolvedValue(undefined),
        preview: vi.fn().mockResolvedValue({ title: "Test", fields: [] }),
        execute: vi.fn().mockResolvedValue({ created: "test-123" }),
        verify: vi.fn().mockResolvedValue({ created: "test-123" }),
        summarize: vi.fn().mockReturnValue("Test summary"),
    };
}

// In-memory store for idempotency tests
type StoredResult = {
    state: "VERIFIED";
    output: unknown;
    timestamp: Date;
};

class InMemoryStore {
    private results = new Map<string, StoredResult>();
    private compensated = new Set<string>();

    async getPriorResult(key: string): Promise<StoredResult | null> {
        return this.results.get(key) || null;
    }

    async saveResult(key: string, result: StoredResult): Promise<void> {
        this.results.set(key, result);
    }

    async markCompensated(key: string): Promise<void> {
        this.compensated.add(key);
    }

    isCompensated(key: string): boolean {
        return this.compensated.has(key);
    }

    reset(): void {
        this.results.clear();
        this.compensated.clear();
    }

    clear(): void {
        this.results.clear();
        this.compensated.clear();
    }
}

// Fake DB that captures log calls
type LogCall = { type: "operational" | "activity" | "audit"; event: any };

class FakeDb {
    calls: LogCall[] = [];

    aiOperationalLog = {
        create: async (args: any) => {
            this.calls.push({
                type: "operational",
                event: args,
            });
        },
    };

    aiWorkflowEvent = {
        create: async (args: any) => {
            this.calls.push({
                type: args.eventType === "USER_ACTIVITY" ? "activity" : args.eventType === "CAPABILITY_AUDIT" ? "audit" : "operational",
                event: args,
            });
        },
    };

    reset(): void {
        this.calls = [];
    }

    count(): number {
        return this.calls.length;
    }
}

// Common test fixtures
let capability: SabahCapability<{ id: string }, { created: string }>;
let actor: SabahActor;
let context: CapabilityContext;
let store: InMemoryStore;
let fakeDb: FakeDb;

beforeEach(() => {
    store = new InMemoryStore();
    fakeDb = new FakeDb();

    // Clear registry before each test
    capabilityRegistry["definitions"].clear();

    capability = createFakeCapability();

    actor = {
        id: "user-1",
        role: "MEMBER",
        departmentIds: ["dept-1"],
    };

    context = {
        actor,
        requestId: "req-1",
        conversationId: "conv-1",
        workflowId: "wf-1",
        now: new Date(),
    };
});

describe("TDD RED - runner tests", () => {
    it("uses the persisted step id for audit relations, not the request correlation id", async () => {
        capabilityRegistry.register(capability);
        const result = await runCapability({ name: "test-capability", input: { id: "test-1" }, explicitUserRequest: true, hasInferredReplacement: false, confidence: 1, itemCount: 1, approvalMode: "SMART", approved: true }, { ...context, stepId: "persisted-step" } as CapabilityContext, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } });
        expect(result.state).toBe("VERIFIED");
        const events = fakeDb.calls.filter(({ event }) => event.data?.eventType === "CAPABILITY_AUDIT" || event.data?.eventType === "USER_ACTIVITY");
        expect(events.length).toBeGreaterThan(0);
        for (const { event } of events) expect(event.data.stepId).toBe("persisted-step");
    });

    it("invalid input never authorizes", async () => {
        const request = {
            name: "test-capability",
            version: 1,
            input: { invalid: "data" }, // Missing 'id' field
            explicitUserRequest: true,
            hasInferredReplacement: false,
            confidence: 1,
            itemCount: 1,
            approvalMode: "SMART" as const,
            approved: false,
        };

        const result = await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } });
        expect(result.state).toBe("FAILED");
    });

    it("unauthorized never previews", async () => {
        const unauthorizedCapability = createFakeCapability();
        unauthorizedCapability.authorize = vi.fn().mockRejectedValue(new Error("Unauthorized"));

        capabilityRegistry.register(unauthorizedCapability);

        const request = {
            name: "test-capability",
            version: 1,
            input: { id: "test-1" },
            explicitUserRequest: true,
            hasInferredReplacement: false,
            confidence: 1,
            itemCount: 1,
            approvalMode: "SMART" as const,
            approved: false,
        };

        await expect(previewCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } }))
            .rejects.toThrow("Unauthorized");
    });

    it("approval-required never executes even when approved=false", async () => {
        const highRiskCapability = createFakeCapability();
        highRiskCapability.risk = "BULK_WRITE";

        capabilityRegistry.register(highRiskCapability);

        const request = {
            name: "test-capability",
            version: 1,
            input: { id: "test-1" },
            explicitUserRequest: true,
            hasInferredReplacement: false,
            confidence: 1,
            itemCount: 5, // Triggers bulk write
            approvalMode: "SMART" as const,
            approved: false,
        };

        const result = await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } });

        expect(result.state).toBe("APPROVAL_REQUIRED");
        expect(highRiskCapability.execute).not.toHaveBeenCalled();
    });

    it("publishes exactly one typed step.failed event when policy blocks", async () => {
        const blockedCapability = createFakeCapability();
        blockedCapability.name = "blocked-capability-event";
        blockedCapability.risk = "BLOCKED";
        capabilityRegistry.register(blockedCapability);
        const events: Array<{ name: string }> = [];
        const eventBus = new LifecycleEventBus({ persistence: { persist: async (event) => { events.push({ name: event.name }); } } });

        const result = await runCapability({
            name: blockedCapability.name, version: 1, input: { id: "test-1" }, explicitUserRequest: true,
            hasInferredReplacement: false, confidence: 1, itemCount: 1, approvalMode: "SMART",
        }, context, { registry: capabilityRegistry, db: fakeDb as unknown as RunnerDeps["db"], store, eventBus, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } });

        expect(result).toEqual({ state: "BLOCKED" });
        expect(events).toEqual([{ name: "step.failed" }]);
    });

    it("requires explicit approval for a sensitive capability even in FAST mode", async () => {
        const sensitive = createFakeCapability();
        sensitive.requiresExplicitApproval = true;
        sensitive.risk = "SENSITIVE_WRITE";
        capabilityRegistry.register(sensitive);
        const request = {
            name: "test-capability", version: 1, input: { id: "test-1" }, explicitUserRequest: true,
            hasInferredReplacement: false, confidence: 1, itemCount: 1, approvalMode: "FAST" as const, approved: false,
        };
        const result = await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } });
        expect(result.state).toBe("APPROVAL_REQUIRED");
        expect(sensitive.execute).not.toHaveBeenCalled();
    });

    it("approved=true with REQUIRE_APPROVAL executes", async () => {
        const highRiskCapability = createFakeCapability();
        highRiskCapability.risk = "BULK_WRITE";

        capabilityRegistry.register(highRiskCapability);

        const request = {
            name: "test-capability",
            version: 1,
            input: { id: "test-1" },
            explicitUserRequest: true,
            hasInferredReplacement: false,
            confidence: 1,
            itemCount: 5,
            approvalMode: "SMART" as const,
            approved: true,
        };

        const result = await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } });

        expect(result.state).toBe("VERIFIED");
        expect(result.output).toEqual({ created: "test-123" });
        expect(highRiskCapability.execute).toHaveBeenCalledTimes(1);
        expect(highRiskCapability.verify).toHaveBeenCalledTimes(1);
    });

    it("output failing outputSchema returns FAILED", async () => {
        const invalidOutputCapability = createFakeCapability();
        invalidOutputCapability.execute = vi.fn().mockResolvedValue({ wrongField: "bad" });
        invalidOutputCapability.verify = vi.fn().mockImplementation((output) => {
            invalidOutputCapability.outputSchema.parse(output);
            return output;
        });

        capabilityRegistry.register(invalidOutputCapability);

        const request = {
            name: "test-capability",
            version: 1,
            input: { id: "test-1" },
            explicitUserRequest: true,
            hasInferredReplacement: false,
            confidence: 1,
            itemCount: 1,
            approvalMode: "SMART" as const,
            approved: false,
        };

        const result = await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } });

        expect(result.state).toBe("FAILED");
    });

    it("verifier throwing returns FAILED_VERIFICATION", async () => {
        const failingVerifierCapability = createFakeCapability();
        failingVerifierCapability.verify = vi.fn().mockRejectedValue(new Error("not found after write"));

        capabilityRegistry.register(failingVerifierCapability);

        const request = {
            name: "test-capability",
            version: 1,
            input: { id: "test-1" },
            explicitUserRequest: true,
            hasInferredReplacement: false,
            confidence: 1,
            itemCount: 1,
            approvalMode: "SMART" as const,
            approved: false,
        };

        const result = await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } });

        expect(result.state).toBe("FAILED_VERIFICATION");
    });

    it("idempotent replay returns stored VERIFIED without re-executing", async () => {
        const idempotentCapability = createFakeCapability();

        capabilityRegistry.register(idempotentCapability);

        const request = {
            name: "test-capability",
            version: 1,
            input: { id: "test-1" },
            explicitUserRequest: true,
            hasInferredReplacement: false,
            confidence: 1,
            itemCount: 1,
            approvalMode: "SMART" as const,
            approved: false,
            idempotencyKey: "unique-key",
        };

        // First execution
        const result1 = await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } });
        expect(result1.state).toBe("VERIFIED");
        expect(idempotentCapability.execute).toHaveBeenCalledTimes(1);

        // Second execution with same key
        const result2 = await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } });
        expect(result2.state).toBe("VERIFIED");
        expect(result2.output).toEqual({ created: "test-123" });

        // Execute should only be called once (first time only)
        expect(idempotentCapability.execute).toHaveBeenCalledTimes(1);
    });

    it("compensation runs exactly once", async () => {
        const compensatableCapability = createFakeCapability();
        compensatableCapability.compensate = vi.fn().mockResolvedValue(undefined);

        capabilityRegistry.register(compensatableCapability);

        const request = {
            name: "test-capability",
            version: 1,
            input: { id: "test-1" },
            explicitUserRequest: true,
            hasInferredReplacement: false,
            confidence: 1,
            itemCount: 1,
            approvalMode: "SMART" as const,
            approved: false,
            idempotencyKey: "comp-key",
        };

        // Execute and get VERIFIED result
        const result = await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } });
        expect(result.state).toBe("VERIFIED");

        // Compensate once
        await compensateCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true }, output: result.output });
        expect(compensatableCapability.compensate).toHaveBeenCalledTimes(1);

        // Compensate again - should not call compensate again
        await compensateCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true }, output: result.output });
        expect(compensatableCapability.compensate).toHaveBeenCalledTimes(1);
    });

    it("writes-disabled flag returns DISABLED without execute", async () => {
        const writeCapability = createFakeCapability();

        capabilityRegistry.register(writeCapability);

        const request = {
            name: "test-capability",
            version: 1,
            input: { id: "test-1" },
            explicitUserRequest: true,
            hasInferredReplacement: false,
            confidence: 1,
            itemCount: 1,
            approvalMode: "SMART" as const,
            approved: false,
        };

        const result = await runCapability(request, context, {
            registry: capabilityRegistry,
            db: fakeDb as any,
            store,
            now: () => new Date(),
            flags: { platform: true, writes: false, memory: false, multimodal: false, monitors: false },
        });

        expect(result.state).toBe("DISABLED");
        expect(writeCapability.execute).not.toHaveBeenCalled();
    });


    it("indexes only after verification and preserves VERIFIED when index/log/retry fail", async () => {
        let verified = false;
        const indexed = vi.fn().mockImplementation(async () => {
            expect(verified).toBe(true);
            throw new Error("index failed");
        });
        const scheduleIndexRetry = vi.fn().mockRejectedValue(new Error("retry failed"));
        fakeDb.aiOperationalLog.create = vi.fn().mockImplementation(async (args: any) => {
            if (args.data?.message === "Verified entity indexing deferred") {
                throw new Error("warning log failed");
            }
        });
        const linked = createFakeCapability() as SabahCapability<{ id: string }, any>;
        linked.outputSchema = z.object({ created: z.string(), entityLinks: z.array(z.object({ type: z.string(), id: z.string(), href: z.string(), label: z.string() })) });
        linked.execute = vi.fn().mockResolvedValue({ created: "test-123", entityLinks: [{ type: "PROJECT", id: "x", href: "/x", label: "x" }] });
        linked.verify = vi.fn().mockImplementation(async (output) => {
            verified = true;
            return output;
        });
        capabilityRegistry.register(linked);
        const request = { name: "test-capability", version: 1, input: { id: "test-1" }, explicitUserRequest: true, hasInferredReplacement: false, confidence: 1, itemCount: 1, approvalMode: "SMART" as const };
        const result = await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true }, indexEntity: indexed, scheduleIndexRetry });
        expect(result).toEqual(expect.objectContaining({ state: "VERIFIED", output: expect.objectContaining({ created: "test-123" }) }));
        expect(linked.verify).toHaveBeenCalledTimes(1);
        expect(indexed).toHaveBeenCalledTimes(1);
        expect(scheduleIndexRetry).toHaveBeenCalledTimes(1);
    });

    it("ignores invalid entity link types", async () => {
        const indexed = vi.fn();
        const linked = createFakeCapability() as SabahCapability<{ id: string }, any>;
        linked.outputSchema = z.object({ created: z.string(), entityLinks: z.array(z.object({ type: z.string(), id: z.string(), href: z.string(), label: z.string() })) });
        linked.execute = vi.fn().mockResolvedValue({ created: "test-123", entityLinks: [{ type: "INVALID", id: "x", href: "/x", label: "x" }] });
        linked.verify = vi.fn().mockResolvedValue({ created: "test-123", entityLinks: [{ type: "INVALID", id: "x", href: "/x", label: "x" }] });
        capabilityRegistry.register(linked);
        const request = { name: "test-capability", version: 1, input: { id: "test-1" }, explicitUserRequest: true, hasInferredReplacement: false, confidence: 1, itemCount: 1, approvalMode: "SMART" as const };
        const result = await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true }, indexEntity: indexed });
        expect(result.state).toBe("VERIFIED");
        expect(indexed).not.toHaveBeenCalled();
    });
    it("ignores links with invalid dates, unsafe hrefs, or empty/oversized fields", async () => {
        const indexed = vi.fn();
        const linked = createFakeCapability() as SabahCapability<{ id: string }, any>;
        linked.outputSchema = z.object({ created: z.string(), entityLinks: z.array(z.record(z.unknown())) });
        linked.execute = vi.fn().mockResolvedValue({ created: "test-123", entityLinks: [
            { type: "PROJECT", id: "x", href: "https://evil.example/x", label: "x" },
            { type: "PROJECT", id: "x", href: "/x//y", label: "x" },
            { type: "PROJECT", id: "x", href: "/x", label: "x", sourceUpdatedAt: "not-a-date" },
            { type: "PROJECT", id: "", href: "/x", label: "x" },
            { type: "PROJECT", id: "x", href: "/x", label: "x".repeat(257) },
        ] });
        linked.verify = vi.fn().mockResolvedValue({ created: "test-123", entityLinks: (await linked.execute({ id: "test-1" }, context)).entityLinks });
        capabilityRegistry.register(linked);
        const request = { name: "test-capability", version: 1, input: { id: "test-1" }, explicitUserRequest: true, hasInferredReplacement: false, confidence: 1, itemCount: 1, approvalMode: "SMART" as const };
        await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true }, indexEntity: indexed });
        expect(indexed).not.toHaveBeenCalled();
    });
    it("writes the dedicated bounded retry event payload", async () => {
        const indexed = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { name: "bad\u0000code".repeat(100) }));
        const linked = createFakeCapability() as SabahCapability<{ id: string }, any>;
        linked.outputSchema = z.object({ created: z.string(), entityLinks: z.array(z.record(z.unknown())) });
        linked.execute = vi.fn().mockResolvedValue({ created: "test-123", entityLinks: [{ type: "PROJECT", id: "x", href: "/x", label: "x", sourceUpdatedAt: "2026-08-26T00:00:00.000Z", checksum: "c" }] });
        linked.verify = vi.fn().mockResolvedValue(await linked.execute({ id: "test-1" }, context));
        capabilityRegistry.register(linked);
        const request = { name: "test-capability", version: 1, input: { id: "test-1" }, explicitUserRequest: true, hasInferredReplacement: false, confidence: 1, itemCount: 1, approvalMode: "SMART" as const };
        await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true }, indexEntity: indexed });
        const retry = fakeDb.calls.find((call) => call.event?.data?.eventType === "WORKSPACE_INDEX_RETRY");
        expect(retry?.event.data.metadataJson).toContain('"entityType":"PROJECT"');
        const metadata = JSON.parse(retry?.event.data.metadataJson ?? "{}");
        expect(metadata.errorCode.length).toBeLessThanOrEqual(128);
        expect(/[\u0000-\u001f\u007f]/.test(metadata.errorCode)).toBe(false);
    });
    it("durably schedules the default retry without a workflow id", async () => {
        const indexed = vi.fn().mockRejectedValue(new Error("boom"));
        const retryDb = { aiWorkflow: { create: vi.fn().mockResolvedValue({ id: "retry-wf" }) }, aiWorkflowEvent: { create: vi.fn() } };
        const linked = createFakeCapability() as SabahCapability<{ id: string }, any>;
        linked.outputSchema = z.object({ created: z.string(), entityLinks: z.array(z.record(z.unknown())) });
        linked.execute = vi.fn().mockResolvedValue({ created: "test-123", entityLinks: [{ type: "PROJECT", id: "x", href: "/x", label: "x" }] });
        linked.verify = vi.fn().mockResolvedValue(await linked.execute({ id: "test-1" }, context));
        capabilityRegistry.register(linked);
        const request = { name: "test-capability", version: 1, input: { id: "test-1" }, explicitUserRequest: true, hasInferredReplacement: false, confidence: 1, itemCount: 1, approvalMode: "SMART" as const };
        await runCapability(request, { ...context, workflowId: null }, { registry: capabilityRegistry, db: fakeDb as any, retryDb: retryDb as any, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true }, indexEntity: indexed });
        expect(retryDb.aiWorkflow.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PLANNED" }) }));
        expect(retryDb.aiWorkflowEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ workflowId: "retry-wf", eventType: "WORKSPACE_INDEX_RETRY" }) }));
    });

    it("every terminal path writes at least one log event", async () => {
        const loggingCapability = createFakeCapability();

        capabilityRegistry.register(loggingCapability);

        const request = {
            name: "test-capability",
            version: 1,
            input: { id: "test-1" },
            explicitUserRequest: true,
            hasInferredReplacement: false,
            confidence: 1,
            itemCount: 1,
            approvalMode: "SMART" as const,
            approved: false,
        };

        // Test VERIFIED path
        await runCapability(request, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: getSabahFlags() });
        expect(fakeDb.count()).toBeGreaterThan(0);

        fakeDb.reset();

        // Test BLOCKED path - distinct name so registration does not collide with the first capability
        const blockedCapability = createFakeCapability();
        blockedCapability.name = "blocked-capability";
        blockedCapability.risk = "BLOCKED";
        capabilityRegistry.register(blockedCapability);

        const blockedRequest = { ...request, name: "blocked-capability" };
        await expect(runCapability(blockedRequest, context, { registry: capabilityRegistry, db: fakeDb as any, store, now: () => new Date(), flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } }))
            .resolves.toHaveProperty("state", "BLOCKED");
        expect(fakeDb.count()).toBeGreaterThan(0);
    });
});