// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../sabah/test/setup";
import { DashboardAnnouncements } from "./dashboard-announcements";

const repositoryRoot = process.cwd();
const publishedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function announcement(overrides: Record<string, unknown> = {}) {
    return {
        id: "announcement-1",
        title: "A normal update",
        body: "The workspace has a new update.",
        variant: "info",
        status: "PUBLISHED",
        priority: "NORMAL",
        createdAt: publishedAt,
        publishAt: publishedAt,
        expiresAt: null,
        ctaUrl: "/tasks",
        requireAcknowledgement: false,
        ...overrides,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("DashboardAnnouncements", () => {
    it("normal announcement never opens dialog", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => response({ announcements: [announcement()] })));

        render(<DashboardAnnouncements />);

        expect(await screen.findByRole("heading", { name: "A normal update" })).toBeVisible();
        expect(screen.getByText("The workspace has a new update.")).toBeVisible();
        expect(screen.getByRole("link", { name: /read more/i })).toHaveAttribute("href", "/tasks");
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("login contains no announcement", async () => {
        const fetchMock = vi.fn(async () => response({ announcements: [] }));
        vi.stubGlobal("fetch", fetchMock);

        render(<DashboardAnnouncements />);

        expect(await screen.findByText(/no announcements right now/i)).toBeVisible();
        expect(fetchMock).toHaveBeenCalledWith("/api/announcements/active");

        const layoutSource = readFileSync(resolve(repositoryRoot, "src/app/(app)/layout.tsx"), "utf8");
        const loginSource = readFileSync(resolve(repositoryRoot, "src/app/login/page.tsx"), "utf8");
        expect(layoutSource).not.toContain("announcement-popup");
        expect(layoutSource).not.toContain("<AnnouncementPopup");
        expect(loginSource).not.toMatch(/DashboardAnnouncements|AnnouncementPopup/);
    });

    it("critical acknowledgement is accessible and persisted", async () => {
        const critical = announcement({
            id: "critical-1",
            title: "Read this critical notice",
            body: "This notice requires acknowledgement.",
            priority: "CRITICAL",
            variant: "warning",
            requireAcknowledgement: true,
            ctaUrl: "/announcements/critical-1",
        });
        const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
            if (String(input).includes("/active")) return response({ announcements: [critical] });
            if (String(input).includes("/seen")) return response({ success: true, acknowledged: true });
            return response({});
        });
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(<DashboardAnnouncements />);

        const dialog = await screen.findByRole("dialog");
        const heading = within(dialog).getByRole("heading", { name: "Read this critical notice" });
        await waitFor(() => expect(heading).toHaveFocus());
        expect(within(dialog).getByRole("button", { name: /i have read/i })).toBeVisible();

        await user.click(within(dialog).getByRole("button", { name: /i have read/i }));

        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        const seenCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/announcements/critical-1/seen"));
        expect(seenCall).toBeDefined();
        expect(seenCall?.[1]).toMatchObject({
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });
        expect(JSON.parse(String(seenCall?.[1]?.body))).toEqual({ acknowledge: true });
    });

    it("expired announcement not shown", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => response({
            announcements: [announcement({
                id: "expired-1",
                title: "Expired notice",
                expiresAt: new Date(Date.now() - 60_000).toISOString(),
            })],
        })));

        render(<DashboardAnnouncements />);

        expect(await screen.findByText(/no announcements right now/i)).toBeVisible();
        expect(screen.queryByText("Expired notice")).toBeNull();
    });
});
