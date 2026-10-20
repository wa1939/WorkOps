import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { resolveModelForRole } from "@/lib/sabah/providers/roles";
import { resolveRuntimeProviderCredentials } from "@/lib/sabah/providers/admin-service";
import { gatherWeekContext, generateExecutiveSummary } from "@/lib/executive-summary";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findFirst: vi.fn() } } }));
vi.mock("@/lib/sabah/auth/actor", () => ({ toSabahActor: vi.fn() }));
vi.mock("@/lib/sabah/providers/roles", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/lib/sabah/providers/roles")>(),
    resolveModelForRole: vi.fn(),
}));
vi.mock("@/lib/sabah/providers/admin-service", () => ({ resolveRuntimeProviderCredentials: vi.fn() }));
vi.mock("@/lib/executive-summary", () => ({
    projectVisibilityWhere: vi.fn(() => ({})),
    gatherWeekContext: vi.fn(async () => ({ done: [], doing: [], overdue: [], upcoming: [], kpiRisk: [] })),
    gatherPromptExtras: vi.fn(async () => ({ styleMemo: null })),
    generateExecutiveSummary: vi.fn(async () => ["First line.", "Second line.", "Third line."]),
}));

const AI_ENV_KEYS = [
    "GLM_API_KEY", "NUHA_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_COMPATIBLE_API_KEY",
    "AI_PROVIDER", "AI_MODEL", "AI_API_KEY", "AI_BASE_URL", "AI_ALLOW_HTTP",
] as const;

let savedEnv: Record<string, string | undefined>;

const openAiAssignment = { providerKey: "openai", modelName: "gpt-4o-mini", config: { fallbacks: [] } };

function postBrief() {
    return new Request("http://localhost/api/projects/p1/brief", { method: "POST" });
}

beforeEach(() => {
    vi.clearAllMocks();
    savedEnv = {};
    for (const key of AI_ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
    }
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", email: "u1@example.com" } } as never);
    vi.mocked(toSabahActor).mockResolvedValue({ id: "u1", role: "ADMIN", departmentIds: [] } as never);
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: "p1" } as never);
    vi.mocked(resolveModelForRole).mockResolvedValue(null as never);
    vi.mocked(resolveRuntimeProviderCredentials).mockResolvedValue({} as never);
});

afterEach(() => {
    for (const key of AI_ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
});

describe("POST /api/projects/[id]/brief", () => {
    it("returns 401 without a session", async () => {
        vi.mocked(auth).mockResolvedValue(null as never);

        const response = await POST(postBrief(), { params: Promise.resolve({ id: "p1" }) });

        expect(response.status).toBe(401);
        expect(generateExecutiveSummary).not.toHaveBeenCalled();
    });

    it("keeps project authorization ahead of AI availability", async () => {
        vi.mocked(prisma.project.findFirst).mockResolvedValue(null as never);

        const response = await POST(postBrief(), { params: Promise.resolve({ id: "p1" }) });

        expect(response.status).toBe(404);
        expect(generateExecutiveSummary).not.toHaveBeenCalled();
    });

    it("keeps the sanitized 503 when no provider, environment key or stored credential exists", async () => {
        const response = await POST(postBrief(), { params: Promise.resolve({ id: "p1" }) });

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: "AI provider not configured" });
        expect(generateExecutiveSummary).not.toHaveBeenCalled();
    });

    it("serves a brief when only an environment key plus the saved CHAT assignment are configured", async () => {
        process.env.OPENAI_API_KEY = "env-key";
        vi.mocked(resolveModelForRole).mockResolvedValue(openAiAssignment as never);

        const response = await POST(postBrief(), { params: Promise.resolve({ id: "p1" }) });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, brief: "First line.\nSecond line.\nThird line." });
        expect(generateExecutiveSummary).toHaveBeenCalledOnce();
    });

    it("serves a brief when only a stored credential for the assigned provider exists", async () => {
        vi.mocked(resolveRuntimeProviderCredentials).mockResolvedValue({ openai: "stored-key" } as never);
        vi.mocked(resolveModelForRole).mockResolvedValue(openAiAssignment as never);

        const response = await POST(postBrief(), { params: Promise.resolve({ id: "p1" }) });

        expect(response.status).toBe(200);
        expect(generateExecutiveSummary).toHaveBeenCalledOnce();
    });

    it("surfaces generation failures through the sanitized 500 path", async () => {
        process.env.GLM_API_KEY = "env-key";
        vi.mocked(generateExecutiveSummary).mockRejectedValueOnce(new Error("Configured CHAT provider or model is unsupported: openai/gpt-4o-mini"));

        const response = await POST(postBrief(), { params: Promise.resolve({ id: "p1" }) });

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "Failed to generate brief" });
        expect(gatherWeekContext).toHaveBeenCalledOnce();
    });
});
