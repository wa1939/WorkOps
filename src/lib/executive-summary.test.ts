import { describe, expect, it, vi } from "vitest";

const callGLMText = vi.fn().mockResolvedValue("السطر الأول.\nالسطر الثاني.\nالسطر الثالث.");

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/reports/history", () => ({ getReportPromptExtrasForActor: vi.fn() }));
vi.mock("@/lib/glm", () => ({ DEFAULT_GLM_MODEL: "glm-5.3-flash", callGLMText: (...args: unknown[]) => callGLMText(...args) }));

const resolveOperationalAiTarget = vi.fn(async () => ({
    provider: "zai" as const,
    model: "glm-5.3-flash" as const,
    fallbacks: [
        { providerKey: "zai" as const, modelName: "glm-4.5-flash" },
        { providerKey: "nuha" as const, modelName: "Nuha-2.1" },
    ],
    credentials: {} as Record<string, string>,
}));
vi.mock("@/lib/ai/provider-resolution", () => ({ resolveOperationalAiTarget: () => resolveOperationalAiTarget() }));

import { generateExecutiveSummary, projectVisibilityWhere } from "./executive-summary";

describe("project brief visibility", () => {
    const actor = { id: "member-1", role: "MEMBER" as const, departmentIds: ["department-a"] };

    it("includes unowned and department-visible projects without granting unrelated owned projects", () => {
        expect(projectVisibilityWhere(actor)).toEqual({
            OR: [
                { ownerId: null },
                { ownerId: actor.id },
                { managerId: actor.id },
                { sponsorId: actor.id },
                { members: { some: { userId: actor.id } } },
                { responsibleDepartmentId: { in: ["department-a"] } },
            ],
        });
    });

    it("does not turn absent department membership into global access", () => {
        expect(projectVisibilityWhere({ ...actor, departmentIds: [] })).toMatchObject({
            OR: expect.arrayContaining([{ responsibleDepartmentId: { in: [] } }]),
        });
        expect(projectVisibilityWhere({ ...actor, role: "ADMIN" })).toEqual({});
    });
});

describe("executive summary model routing", () => {
    it("uses the current shared default model", async () => {
        await expect(generateExecutiveSummary({ done: [], doing: [], overdue: [], upcoming: [], kpiRisk: [] })).resolves.toHaveLength(3);

        expect(callGLMText.mock.calls[0][1]).toMatchObject({ model: "glm-5.3-flash" });
    });

    it("routes through the resolved operational target for stored-credential deployments", async () => {
        resolveOperationalAiTarget.mockResolvedValueOnce({
            provider: "openai",
            model: "gpt-4o-mini",
            fallbacks: [],
            credentials: { openai: "stored-key" },
        } as never);

        await expect(generateExecutiveSummary({ done: [], doing: [], overdue: [], upcoming: [], kpiRisk: [] })).resolves.toHaveLength(3);

        expect(callGLMText.mock.calls[0][1]).toMatchObject({
            provider: "openai",
            model: "gpt-4o-mini",
            fallbacks: [],
            credentials: { openai: "stored-key" },
        });
    });
});