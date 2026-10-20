import { afterEach, describe, expect, it, vi } from "vitest";
import { callGLM, callGLMText } from "@/lib/glm";
import { buildOperationalAiTarget } from "./provider-resolution";
import { hasConfiguredAi } from "./provider-config";

const completion = () => new Response(JSON.stringify({ choices: [{ message: { content: "Configured provider answer" }, finish_reason: "stop" }] }), { status: 200 });
function configure(provider: string, model: string) {
    vi.stubEnv("AI_PROVIDER", provider);
    vi.stubEnv("AI_MODEL", model);
    vi.stubEnv("AI_API_KEY", "synthetic-provider-key");
    vi.stubEnv("GLM_API_KEY", "");
    vi.stubEnv("NUHA_API_KEY", "");
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("bring your own AI provider", () => {
    it("does not hide an enabled stored provider when the deployment default has no key", () => {
        configure("openai", "default-model");
        vi.stubEnv("AI_API_KEY", ""); vi.stubEnv("OPENAI_API_KEY", "");
        expect(hasConfiguredAi({ anthropic: "synthetic-stored-claude-key" })).toBe(true);
    });
    it("uses the configured OpenAI model for shared text helpers without a GLM key", async () => {
        configure("openai", "operator-selected-model");
        const fetcher = vi.fn().mockImplementation(completion); vi.stubGlobal("fetch", fetcher);
        expect(await callGLMText("Summarize work")).toBe("Configured provider answer");
        expect(fetcher.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
        expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe("operator-selected-model");
    });
    it("uses an operator-defined compatible endpoint and model", async () => {
        configure("openai-compatible", "team-private-model");
        vi.stubEnv("AI_BASE_URL", "https://models.example.test/v1/");
        const fetcher = vi.fn().mockImplementation(completion); vi.stubGlobal("fetch", fetcher);
        await callGLMText("Prepare a work brief");
        expect(fetcher.mock.calls[0][0]).toBe("https://models.example.test/v1/chat/completions");
        expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe("team-private-model");
    });
    it("rejects unknown providers rather than silently using GLM", async () => {
        configure("unsupported-protocol", "chosen-model");
        const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
        await expect(callGLMText("hello")).rejects.toThrow(/provider/i);
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("does not fall back to another vendor after a selected provider rejects a request", async () => {
        configure("openai", "chosen-model"); vi.stubEnv("GLM_API_KEY", "synthetic-unused-key");
        const fetcher = vi.fn().mockResolvedValue(new Response("rejected", { status: 400 })); vi.stubGlobal("fetch", fetcher);
        await expect(callGLMText("hello")).rejects.toThrow();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0][0]).toContain("api.openai.com");
    });
    it("rejects credentials embedded in a custom URL before sending a request", async () => {
        configure("openai-compatible", "chosen-model"); vi.stubEnv("AI_BASE_URL", "https://user:synthetic@models.example.test/v1");
        const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
        await expect(callGLMText("hello")).rejects.toThrow(/AI_BASE_URL/);
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("accepts an administrator's OpenAI model assignment with no automatic cross-vendor fallback", () => {
        const target = buildOperationalAiTarget({ providerKey: "openai", modelName: "my-model", config: {} });
        expect(target.provider).toBe("openai"); expect(target.model).toBe("my-model"); expect(target.fallbacks).toEqual([]);
    });
    it("routes Claude to the native Anthropic API with the operator-selected model", async () => {
        configure("anthropic", "operator-selected-claude");
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg_synthetic", type: "message", role: "assistant", model: "operator-selected-claude", content: [{ type: "text", text: "Native Claude answer" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fetcher);
        expect((await callGLM({ messages: [{ role: "user", content: "hello" }] })).content).toBe("Native Claude answer");
        expect(String(fetcher.mock.calls[0][0])).toBe("https://api.anthropic.com/v1/messages");
        expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe("operator-selected-claude");
    });
});
