// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementsManager } from "./announcements-manager";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: toastMock }),
}));

const department = { id: "department-design", name: "Design" };

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function row(overrides: Record<string, unknown> = {}) {
    return {
        id: "announcement-1",
        title: "Workspace update",
        body: "The workspace has a new update.",
        variant: "info",
        status: "PUBLISHED",
        isActive: true,
        createdAt: "2026-09-08T08:00:00.000Z",
        publishAt: "2026-09-08T08:00:00.000Z",
        expiresAt: null,
        ctaUrl: "/tasks",
        audienceJson: JSON.stringify({ departments: [], includeFutureMembers: false }),
        audienceVersion: 2,
        eligibleCount: 2,
        seenCount: 1,
        acknowledgedCount: 1,
        _count: { seenBy: 9 },
        createdBy: { name: "Admin User" },
        ...overrides,
    };
}

function installFetch(initialRows = [row()]) {
    let rows = initialRows;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/admin/departments") {
            return response([department]);
        }
        if (url === "/api/users") {
            return response([
                { id: "user-1", name: "A. Member", email: "member@example.test" },
                { id: "user-2", name: "B. Member", email: "member2@example.test" },
            ]);
        }
        if (url.startsWith("/api/announcements?preview=1")) {
            return response({ audienceCount: 2, eligibleCount: 2, audienceVersion: 3 });
        }
        if (url === "/api/announcements" && init?.method === "POST") {
            const payload = JSON.parse(String(init.body));
            const created = row({
                id: "announcement-created",
                ...payload,
                audienceJson: payload.audienceJson,
                status: payload.status ?? "PUBLISHED",
            });
            rows = [created, ...rows];
            return response({ announcement: created }, 201);
        }
        if (url === "/api/announcements") {
            return response({ announcements: rows, activeUsers: 10 });
        }
        const match = url.match(/^\/api\/announcements\/([^/?]+)$/);
        if (match && init?.method === "PATCH") {
            const payload = JSON.parse(String(init.body));
            rows = rows.map((item) => item.id === match[1] ? { ...item, ...payload, isActive: payload.status === "ARCHIVED" ? false : item.isActive } : item);
            return response({ announcement: rows.find((item) => item.id === match[1]) });
        }
        throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("AnnouncementsManager", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("publish requires audience confirmation", async () => {
        const fetchMock = installFetch([]);
        const user = userEvent.setup();
        render(<AnnouncementsManager />);

        await user.type(await screen.findByLabelText("Title"), "Targeted release");
        await user.type(screen.getByLabelText("Message"), "A release for one audience.");
        await user.click(screen.getByRole("button", { name: /Preview audience/i }));

        expect(await screen.findByText(/2 eligible members/i)).toBeTruthy();
        await user.click(screen.getByRole("button", { name: /Publish now/i }));
        expect(screen.getByText(/confirm the audience preview/i)).toBeTruthy();
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

        await user.click(screen.getByRole("button", { name: /Confirm audience/i }));
        await user.click(screen.getByRole("button", { name: /Publish now/i }));

        await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
        const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
        const payload = JSON.parse(String(postCall?.[1]?.body));
        expect(payload.status).toBe("PUBLISHED");
        expect(payload.audienceJson).toBe(JSON.stringify({ departments: [], includeFutureMembers: false }));
    });

    it("archive does not delete", async () => {
        const fetchMock = installFetch([row()]);
        const user = userEvent.setup();
        render(<AnnouncementsManager />);

        expect(await screen.findByText("Workspace update")).toBeTruthy();
        await user.click(screen.getByRole("button", { name: /Archive Workspace update/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
            "/api/announcements/announcement-1",
            expect.objectContaining({
                method: "PATCH",
                body: JSON.stringify({ status: "ARCHIVED" }),
            }),
        ));
        expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes("/announcement-1") && init?.method === "DELETE")).toBe(false);
        expect(screen.getByText("Workspace update")).toBeTruthy();
        expect(screen.getByRole("heading", { name: "Archived" })).toBeTruthy();
    });

    it("counts use scoped denominator", async () => {
        installFetch([row({ _count: { seenBy: 9 }, activeUsers: 10 })]);
        render(<AnnouncementsManager />);

        expect(await screen.findByText(/Seen by 1\/2/i)).toBeTruthy();
        expect(screen.getByText(/Acknowledged 1\/2/i)).toBeTruthy();
        expect(screen.queryByText(/Seen by 1\/10/i)).toBeNull();
    });
});
