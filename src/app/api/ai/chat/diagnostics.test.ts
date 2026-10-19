import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { callGLMStream, type GLMStreamChunk } from "@/lib/glm";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { resolveModelForRole, getConfiguredFallbacks } from "@/lib/sabah/providers/roles";
import { resolveRuntimeProviderCredentials } from "@/lib/sabah/providers/admin-service";
import { runTool } from "@/lib/ai/executors";
import { recordDiagnostic } from "@/lib/diagnostics";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
    aiConversation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    aiMessage: { create: vi.fn(), findMany: vi.fn() },
} }));
vi.mock("@/lib/glm", () => ({ callGLMStream: vi.fn() }));
vi.mock("@/lib/sabah/auth/actor", () => ({ toSabahActor: vi.fn(), SabahForbiddenError: class extends Error {} }));
vi.mock("@/lib/sabah/providers/roles", () => ({ resolveModelForRole: vi.fn(), getConfiguredFallbacks: vi.fn() }));
vi.mock("@/lib/sabah/providers/admin-service", () => ({ resolveRuntimeProviderCredentials: vi.fn() }));
vi.mock("@/lib/ai/executors", () => ({ runTool: vi.fn() }));
vi.mock("@/lib/ai/tools", () => ({ AI_TOOLS: [] }));
vi.mock("@/lib/ai/system-prompt", () => ({ buildSystemPrompt: vi.fn().mockResolvedValue("system") }));
vi.mock("@/lib/sabah/continuity/compression", () => ({ compressConversation: vi.fn() }));
vi.mock("@/lib/diagnostics", async () => {
    const actual = await vi.importActual<typeof import("@/lib/diagnostics")>("@/lib/diagnostics");
    return { ...actual, recordDiagnostic: vi.fn().mockResolvedValue(undefined) };
});

const glmMock = vi.mocked(callGLMStream);
const diagMock = vi.mocked(recordDiagnostic);
const finish = (content = "ok", toolCalls: any[] = []): GLMStreamChunk => ({ type: "finish", finishReason: toolCalls.length ? "tool_calls" : "stop", toolCalls, content });
const request = () => new Request("http://localhost/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "safe question" }) });

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("GLM_API_KEY", "test-key");
    diagMock.mockResolvedValue(undefined);
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", name: "User", email: "u@example.com" } } as any);
    vi.mocked(toSabahActor).mockResolvedValue({ id: "user-1", role: "LEAD", departmentIds: [] } as any);
    vi.mocked(resolveRuntimeProviderCredentials).mockResolvedValue({});
    vi.mocked(resolveModelForRole).mockResolvedValue({ providerKey: "zai", modelName: "glm-5", config: {} });
    vi.mocked(getConfiguredFallbacks).mockReturnValue(undefined);
    vi.mocked(prisma.aiConversation.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.aiConversation.create).mockResolvedValue({ id: "conv-1" } as never);
    vi.mocked(prisma.aiConversation.update).mockResolvedValue({} as never);
    vi.mocked(prisma.aiMessage.create).mockResolvedValue({} as never);
    vi.mocked(prisma.aiMessage.findMany).mockResolvedValue([] as never);
    vi.mocked(runTool).mockResolvedValue({ ok: true, data: { ok: true } } as never);
});

describe("chat diagnostics instrumentation", () => {
    it("returns a bounded correlation header and awaits start/completion events", async () => {
        glmMock.mockImplementationOnce(async function* () { yield finish("ok"); });
        const response = await POST(request());
        await response.text();
        const categories = diagMock.mock.calls.map(([event]) => event.category);
        expect(response.headers.get("X-Correlation-ID")).toMatch(/^diag-[A-Za-z0-9-]{20,}$/);
        expect(categories).toEqual(expect.arrayContaining(["CHAT_REQUEST_START", "CHAT_REQUEST_COMPLETE"]));
        expect(new Set(diagMock.mock.calls.map(([event]) => event.correlationId)).size).toBe(1);
    });

    it("maps provider callbacks to redacted diagnostic events and passes explicit fallbacks", async () => {
        vi.mocked(getConfiguredFallbacks).mockReturnValue([{ providerKey: "nuha", modelName: "Nuha-2.1" }] as any);
        glmMock.mockImplementationOnce(async function* (options: any) {
            await options.onDiagnostic({ event: "error", provider: "zai", model: "glm-5", attempt: 1, status: 500, errorCode: "E_PROVIDER", message: "token=provider-secret" });
            yield { type: "error", message: "provider failed", retryable: false };
        });
        const response = await POST(request());
        await response.text();
        expect(glmMock).toHaveBeenCalledWith(expect.objectContaining({ fallbacks: [{ providerKey: "nuha", modelName: "Nuha-2.1" }], onDiagnostic: expect.any(Function) }));
        const providerEvent = diagMock.mock.calls.map(([event]) => event).find((event) => event.category === "PROVIDER_ERROR");
        expect(providerEvent).toBeDefined();
        expect(JSON.stringify(providerEvent)).not.toContain("provider-secret");
        expect(providerEvent?.metadata).toMatchObject({ provider: "zai", model: "glm-5", attempt: 1, status: 500, errorCode: "E_PROVIDER" });
    });

    it("records tool outcomes without persisting parameters or results", async () => {
        glmMock
            .mockImplementationOnce(async function* () { yield finish("", [{ id: "tool-1", type: "function", function: { name: "listMyTasks", arguments: JSON.stringify({ secret: "do-not-log" }) } }]); })
            .mockImplementationOnce(async function* () { yield finish("done"); });
        const response = await POST(request());
        await response.text();
        const toolEvent = diagMock.mock.calls.map(([event]) => event).find((event) => event.category === "CHAT_TOOL_OUTCOME");
        expect(toolEvent?.metadata).toMatchObject({ toolName: "listMyTasks", ok: true });
        expect(JSON.stringify(toolEvent)).not.toContain("do-not-log");
    });
});
