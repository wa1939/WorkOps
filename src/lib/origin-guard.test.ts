import { describe, expect, it, vi } from "vitest";
import { assertSameOrigin, OriginGuardError, withOriginGuard } from "./origin-guard";

const request = (url: string, headers: Record<string, string> = {}) =>
    new Request(url, { headers });

describe("assertSameOrigin", () => {
    it("allows a same-origin request", () => {
        expect(() =>
            assertSameOrigin(
                request("https://app.example.test/api/tasks", {
                    host: "app.example.test",
                    origin: "https://app.example.test",
                }),
            ),
        ).not.toThrow();
    });

    it("allows requests without Origin for native clients", () => {
        expect(() =>
            assertSameOrigin(
                request("https://app.example.test/api/tasks", {
                    host: "app.example.test",
                }),
            ),
        ).not.toThrow();
    });

    it("rejects a cross-origin request", () => {
        expect(() =>
            assertSameOrigin(
                request("https://app.example.test/api/tasks", {
                    host: "app.example.test",
                    origin: "https://evil.example.test",
                }),
            ),
        ).toThrow(OriginGuardError);
    });

    it("accepts an origin matching the trusted forwarded host", () => {
        expect(() =>
            assertSameOrigin(
                request("http://internal-web:3000/api/tasks", {
                    host: "internal-web:3000",
                    origin: "https://app.example.test",
                    "x-forwarded-host": "app.example.test",
                }),
            ),
        ).not.toThrow();
    });
});

describe("withOriginGuard", () => {
    it("returns a forbidden response and skips the handler for a cross-origin request", async () => {
        const handler = vi.fn(async () => new Response("handled", { status: 200 }));
        const guardedHandler = withOriginGuard(handler);

        const response = await guardedHandler(
            request("https://app.example.test/api/tasks", {
                host: "app.example.test",
                origin: "https://evil.example.test",
            }),
        );

        expect(response.status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });
});
