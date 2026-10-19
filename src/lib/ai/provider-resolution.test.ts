import { describe, expect, it, vi } from "vitest";
import { callGLMText, DEFAULT_GLM_BASE_URL } from "@/lib/glm";
import { resolveOperationalAiTarget } from "./provider-resolution";

const successfulResponse = () => new Response(JSON.stringify({
    choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
}), { status: 200 });

describe("resolveOperationalAiTarget", () => {
    it("uses GLM-5.3-Flash as the operational default when CHAT is unassigned", async () => {
        const db = {
            aiModelAssignment: { findUnique: vi.fn().mockResolvedValue(null) },
            aiProviderCredential: { findMany: vi.fn().mockResolvedValue([]) },
        };

        await expect(resolveOperationalAiTarget(db as never)).resolves.toMatchObject({
            provider: "zai",
            model: "glm-5.3-flash",
            fallbacks: [
                { providerKey: "zai", modelName: "glm-4.5-flash" },
                { providerKey: "nuha", modelName: "Nuha-2.1" },
            ],
            credentials: {},
        });
    });

    it("uses the Coding Plan endpoint and primary model for the default text call", async () => {
        vi.stubEnv("GLM_API_KEY", "synthetic-glm-key");
        const fetchMock = vi.fn<typeof fetch>(async () => successfulResponse());
        vi.stubGlobal("fetch", fetchMock);

        await expect(callGLMText("hello", { fallbacks: [] })).resolves.toBe("ok");

        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(String(url)).toBe(`${DEFAULT_GLM_BASE_URL}/chat/completions`);
        expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
            model: "glm-5.3-flash",
            max_tokens: 2000,
        });
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });
});
