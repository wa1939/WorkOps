// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../sabah/test/setup";
import { CommunicationsManager } from "./communications-manager";

const rules = {
    categories: ["task"],
    config: [],
    policy: { categories: ["task"], internalDomains: ["example.test"] },
};

const recipients = {
    category: "task",
    configKey: "NOTIFICATION_TASK_TO",
    recipients: [],
    validation: { valid: [], invalid: [], duplicatesRemoved: [], externalBlocked: [] },
    previewOnly: true,
    updatedAt: null,
};

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("CommunicationsManager", () => {
    it("test send never broadcasts", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (init?.method === "POST") return response({ id: "delivery-test-1", queued: true });
            if (url.includes("view=rules")) return response(rules);
            return response(recipients);
        });
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(<CommunicationsManager />);
        await user.click(screen.getByRole("tab", { name: "Test send" }));
        await user.click(await screen.findByRole("button", { name: /queue test notification/i }));

        const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
        expect(postCall).toBeDefined();
        const body = JSON.parse(String(postCall?.[1]?.body));
        expect(body).toMatchObject({ action: "test-send", channel: "email" });
        expect(body).not.toHaveProperty("destination");
        expect(await screen.findByText(/delivery-test-1/)).toBeVisible();
    });

    it("accepted not labeled delivered", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("view=rules")) return response(rules);
            if (url.includes("view=recipients")) return response(recipients);
            return response({
                rows: [{
                    id: "delivery-accepted-1",
                    event: { category: "task", sourceType: "admin_test_send" },
                    channel: "email",
                    destinationKey: "***@example.test",
                    state: "ACCEPTED",
                    attempts: 1,
                    providerId: "provider-1",
                    lastError: null,
                    createdAt: "2026-09-07T10:00:00.000Z",
                    updatedAt: "2026-09-07T10:00:00.000Z",
                }],
                total: 1,
                page: 1,
                pageSize: 25,
                hasMore: false,
            });
        });
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(<CommunicationsManager />);
        await user.click(screen.getByRole("tab", { name: "Delivery log" }));

        expect(await screen.findByText("ACCEPTED", { selector: "span" })).toBeVisible();
        expect(screen.queryByText("DELIVERED", { selector: "span" })).toBeNull();
    });

    it("workspace admin cannot inspect other recipients", async () => {
        const fullEmail = "other.person@example.test";
        let responseJson = "";
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("view=rules")) return response({ error: "Forbidden" }, 403);
            const body = {
                rows: [{
                    id: "delivery-redacted-1",
                    event: { category: "task", sourceType: "test" },
                    channel: "email",
                    destinationKey: "***@example.test",
                    state: "FAILED",
                    attempts: 1,
                    providerId: null,
                    lastError: "[REDACTED]",
                    createdAt: "2026-09-07T10:00:00.000Z",
                    updatedAt: "2026-09-07T10:00:00.000Z",
                }],
                total: 1,
                page: 1,
                pageSize: 25,
                hasMore: false,
            };
            responseJson = JSON.stringify(body);
            return response(body);
        });
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(<CommunicationsManager />);
        expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
        await user.click(screen.getByRole("tab", { name: "Delivery log" }));
        expect(await screen.findByText("***@example.test")).toBeVisible();
        expect(screen.queryByText(fullEmail)).toBeNull();
        expect(responseJson).not.toContain(fullEmail);
    });
});
