import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { resolveModelForRole } from "@/lib/sabah/providers/roles";
import { resolveRuntimeProviderCredentials } from "@/lib/sabah/providers/admin-service";
import { generateExecutiveSummary } from "@/lib/executive-summary";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findMany: vi.fn(async () => []) },
        task: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
        project: { count: vi.fn(async () => 0) },
        kPI: { count: vi.fn(async () => 0) },
        notification: { createMany: vi.fn(async () => ({ count: 0 })) },
    },
}));
vi.mock("@/lib/email", () => ({ sendSundayDigest: vi.fn() }));
vi.mock("@/lib/communications/digest", () => ({
    buildDigestPreview: vi.fn(),
    saveDigestDraft: vi.fn(async () => ({ id: "draft-1" })),
    sendApprovedDigest: vi.fn(async () => ({ sent: [], outcomes: [], validation: { valid: [], invalid: [] } })),
}));
vi.mock("@/lib/communications/domains", () => ({ configuredInternalDomains: vi.fn(() => ["example.com"]) }));
vi.mock("@/lib/executive-summary", () => ({
    gatherWeekContext: vi.fn(async () => ({ done: [], doing: [], overdue: [], upcoming: [], kpiRisk: [] })),
    gatherPromptExtras: vi.fn(async () => ({ styleMemo: null })),
    generateExecutiveSummary: vi.fn(async () => ["First line.", "Second line.", "Third line."]),
}));
vi.mock("@/lib/sabah/auth/actor", () => ({ toSabahActor: vi.fn() }));
vi.mock("@/lib/sabah/providers/roles", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/lib/sabah/providers/roles")>(),
    resolveModelForRole: vi.fn(),
}));
vi.mock("@/lib/sabah/providers/admin-service", () => ({ resolveRuntimeProviderCredentials: vi.fn() }));

const AI_ENV_KEYS = [
    "GLM_API_KEY", "NUHA_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_COMPATIBLE_API_KEY",
    "AI_PROVIDER", "AI_MODEL", "AI_API_KEY", "AI_BASE_URL", "AI_ALLOW_HTTP",
] as const;

let savedEnv: Record<string, string | undefined>;

const openAiAssignment = { providerKey: "openai", modelName: "gpt-4o-mini", config: { fallbacks: [] } };

function cronGet(headers: Record<string, string> = {}) {
    return new Request("http://localhost/api/cron/sunday-digest", { method: "GET", headers });
}

function adminPost(query: string) {
    return new Request(`http://localhost/api/cron/sunday-digest${query}`, { method: "POST" });
}

beforeEach(() => {
    vi.clearAllMocks();
    savedEnv = {};
    for (const key of AI_ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
    }
    savedEnv.CRON_SECRET = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-cron-secret";
    vi.mocked(resolveModelForRole).mockResolvedValue(null as never);
    vi.mocked(resolveRuntimeProviderCredentials).mockResolvedValue({} as never);
});

afterEach(() => {
    for (const key of AI_ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
    if (savedEnv.CRON_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedEnv.CRON_SECRET;
});

describe("GET /api/cron/sunday-digest", () => {
    it("keeps bearer-secret authorization", async () => {
        const response = await GET(cronGet({ authorization: "Bearer wrong-secret" }));

        expect(response.status).toBe(401);
        expect(generateExecutiveSummary).not.toHaveBeenCalled();
    });

    it("keeps the unconfigured failure when no provider, environment key or stored credential exists", async () => {
        const response = await GET(cronGet({ authorization: "Bearer test-cron-secret" }));

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "AI provider not configured" });
        expect(generateExecutiveSummary).not.toHaveBeenCalled();
    });

    it("runs the digest when only an environment key plus the saved CHAT assignment are configured", async () => {
        process.env.OPENAI_API_KEY = "env-key";
        vi.mocked(resolveModelForRole).mockResolvedValue(openAiAssignment as never);

        const response = await GET(cronGet({ authorization: "Bearer test-cron-secret" }));

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.report.bullets).toHaveLength(3);
        expect(generateExecutiveSummary).toHaveBeenCalledOnce();
    });

    it("runs the digest when only a stored credential for the assigned provider exists", async () => {
        vi.mocked(resolveRuntimeProviderCredentials).mockResolvedValue({ openai: "stored-key" } as never);
        vi.mocked(resolveModelForRole).mockResolvedValue(openAiAssignment as never);

        const response = await GET(cronGet({ authorization: "Bearer test-cron-secret" }));

        expect(response.status).toBe(200);
        expect((await response.json()).success).toBe(true);
    });
});

describe("POST /api/cron/sunday-digest", () => {
    it("keeps the admin-only gate ahead of AI availability", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "u1", email: "u1@example.com" } } as never);
        vi.mocked(toSabahActor).mockResolvedValue({ id: "u1", role: "MEMBER", departmentIds: [] } as never);

        const response = await POST(adminPost("?draft=true"));

        expect(response.status).toBe(403);
        expect(generateExecutiveSummary).not.toHaveBeenCalled();
    });

    it("saves an admin draft when only an environment key plus the saved CHAT assignment are configured", async () => {
        process.env.OPENAI_API_KEY = "env-key";
        vi.mocked(resolveModelForRole).mockResolvedValue(openAiAssignment as never);
        vi.mocked(auth).mockResolvedValue({ user: { id: "u1", email: "u1@example.com" } } as never);
        vi.mocked(toSabahActor).mockResolvedValue({ id: "u1", role: "ADMIN", departmentIds: [] } as never);

        const response = await POST(adminPost("?draft=true"));

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.mail).toEqual({ skipped: true, reason: "draft saved" });
        expect(generateExecutiveSummary).toHaveBeenCalledOnce();
    });
});
