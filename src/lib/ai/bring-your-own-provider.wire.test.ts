import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { callGLM, callGLMStream } from "@/lib/glm";

/**
 * Wire-level protocol coverage: the OpenAI-compatible chat-completions
 * transport against a real loopback HTTP server. No external vendor traffic
 * and no real keys — only synthetic local credentials. Loopback HTTP requires
 * the operator opt-in AI_ALLOW_HTTP=1, which these tests exercise explicitly.
 */

type RecordedRequest = { method: string; path: string; authorization: string | null; body: Record<string, unknown> };

let server: Server | null = null;
const requests: RecordedRequest[] = [];

function startMockCompatServer(respond: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<string> {
    requests.length = 0;
    return new Promise((resolve, reject) => {
        const instance = createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            req.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf8");
                let body: Record<string, unknown> = {};
                try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* recorded as empty */ }
                requests.push({
                    method: req.method ?? "",
                    path: req.url ?? "",
                    authorization: req.headers.authorization ?? null,
                    body,
                });
                respond(req, res, raw);
            });
        });
        server = instance;
        instance.on("error", reject);
        instance.listen(0, "127.0.0.1", () => {
            const address = instance.address() as AddressInfo;
            resolve(`http://127.0.0.1:${address.port}/v1`);
        });
    });
}

function configureCompatEnv(baseUrl: string) {
    vi.stubEnv("AI_PROVIDER", "openai-compatible");
    vi.stubEnv("AI_MODEL", "team-private-model");
    vi.stubEnv("AI_BASE_URL", baseUrl);
    vi.stubEnv("AI_ALLOW_HTTP", "1");
    vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "synthetic-local-key");
    vi.stubEnv("GLM_API_KEY", "");
    vi.stubEnv("NUHA_API_KEY", "");
}

afterEach(async () => {
    vi.unstubAllEnvs();
    if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = null;
    }
});

describe("openai-compatible transport over a local mock server", () => {
    it("sends the documented wire request and parses the completion", async () => {
        const baseUrl = await startMockCompatServer((_req, res) => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ choices: [{ message: { content: "Local answer" }, finish_reason: "stop" }] }));
        });
        configureCompatEnv(baseUrl);

        const content = await (async () => {
            const response = await callGLM({ messages: [{ role: "user", content: "hello" }], fallbacks: [] });
            return response.content;
        })();

        expect(content).toBe("Local answer");
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe("POST");
        expect(requests[0].path).toBe("/v1/chat/completions");
        expect(requests[0].authorization).toBe("Bearer synthetic-local-key");
        expect(requests[0].body.model).toBe("team-private-model");
        expect(requests[0].body.stream).toBeUndefined();
        expect(requests[0].body.max_tokens).toBe(2000);
    });

    it("streams SSE deltas across chunk boundaries split mid-UTF-8-character", async () => {
        const frames = [
            JSON.stringify({ choices: [{ delta: { content: "h" } }] }),
            JSON.stringify({ choices: [{ delta: { content: "é" } }] }),
            JSON.stringify({ choices: [{ delta: { content: "llo" } }] }),
            JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        ];
        // Split the encoded frames at byte offsets that cut inside "é" (2 bytes).
        const payload = frames.map((frame) => `data: ${frame}\n\n`).join("");
        const splitMidUtf8 = payload.indexOf("é") + 1;
        const baseUrl = await startMockCompatServer((_req, res) => {
            res.writeHead(200, { "content-type": "text/event-stream" });
            const bytes = Buffer.from(payload + "data: [DONE]\n\n", "utf8");
            res.write(bytes.subarray(0, splitMidUtf8));
            setTimeout(() => {
                res.end(bytes.subarray(splitMidUtf8));
            }, 10);
        });
        configureCompatEnv(baseUrl);

        const deltas: string[] = [];
        let finish: { finishReason: string; content: string } | undefined;
        for await (const chunk of callGLMStream({
            messages: [{ role: "user", content: "hello" }],
            fallbacks: [],
        })) {
            if (chunk.type === "content_delta") deltas.push(chunk.delta);
            if (chunk.type === "finish") finish = { finishReason: chunk.finishReason, content: chunk.content };
        }

        expect(deltas.join("")).toBe("héllo");
        expect(finish?.finishReason).toBe("stop");
        expect(finish?.content).toBe("héllo");
        expect(requests[0].body.stream).toBe(true);
    });

    it("refuses loopback HTTP without the operator opt-in before sending a request", async () => {
        const baseUrl = await startMockCompatServer((_req, res) => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ choices: [{ message: { content: "should not happen" } }] }));
        });
        configureCompatEnv(baseUrl);
        vi.stubEnv("AI_ALLOW_HTTP", "");

        await expect(callGLM({ messages: [{ role: "user", content: "hello" }], fallbacks: [] })).rejects.toThrow(/AI_ALLOW_HTTP/);
        expect(requests).toHaveLength(0);
    });
});
