// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/components/sabah/test/setup";
import { TaskViewBlock } from "./task-view-block";
import type { Block } from "./block-editor";

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function task(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        title: `Task ${id}`,
        taskKey: null,
        status: "TODO",
        priority: "MEDIUM",
        dueAt: "2026-10-08T12:00:00.000Z",
        dueDate: null,
        project: { id: "project-1", name: "Project Alpha" },
        assignments: [{ userId: "user-1", user: { id: "user-1", name: "Amina", image: null } }],
        updatedAt: "2026-10-07T12:00:00.000Z",
        createdAt: "2026-10-01T12:00:00.000Z",
        ...overrides,
    };
}

const block = (overrides: Partial<Block> = {}): Block => ({
    id: "daily",
    type: "taskView",
    viewType: "table",
    assigneeIds: ["@me"],
    dueRange: "today",
    sortBy: "dueAt",
    ...overrides,
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("TaskViewBlock", () => {
    it("requests the reviewed endpoint with actor-relative and deep task filters", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL) => response({ rows: [task("one")], totalCount: 3, nextOffset: 50 }));
        vi.stubGlobal("fetch", fetchMock);

        render(<TaskViewBlock block={block()} userId="actor-1" color="cyan" />);

        expect(await screen.findByRole("link", { name: "Task one" })).toHaveAttribute("href", "/tasks/one");
        const url = String(fetchMock.mock.calls[0]?.[0]);
        expect(url.startsWith("/api/tasks/view-data?")).toBe(true);
        const params = new URL(url, "http://localhost").searchParams;
        expect(params.get("assigneeIds")).toBe("@me");
        expect(params.get("dueRange")).toBe("today");
        expect(params.get("sortBy")).toBe("dueAt");
        expect(screen.getByText("1 loaded of 3 matching tasks")).toBeVisible();
    });

    it("appends pages in server order, deduplicates rows, and stops when exhausted", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({ rows: [task("one")], totalCount: 2, nextOffset: 1 }))
            .mockResolvedValueOnce(response({ rows: [task("one"), task("two", { title: "Task two" })], totalCount: 2, nextOffset: null }));
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(<TaskViewBlock block={block()} userId="actor-1" color="cyan" />);
        await screen.findByRole("link", { name: "Task one" });
        await user.click(screen.getByRole("button", { name: "Load more" }));

        expect(await screen.findByRole("link", { name: "Task two" })).toBeVisible();
        expect(screen.getAllByRole("link", { name: "Task one" })).toHaveLength(1);
        expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
        expect(screen.getByText("2 loaded of 2 matching tasks")).toBeVisible();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(new URL(String(fetchMock.mock.calls[1]?.[0]), "http://localhost").searchParams.get("offset")).toBe("1");
    });

    it("renders each assignee grouping, including unassigned, without duplicating the loaded total", async () => {
        const fetchMock = vi.fn(async () => response({
            rows: [
                task("multi", {
                    title: "Shared task",
                    assignments: [
                        { userId: "user-1", user: { id: "user-1", name: "Amina", image: null } },
                        { userId: "user-2", user: { id: "user-2", name: "Bilal", image: null } },
                    ],
                }),
                task("unassigned", { title: "Unassigned task", assignments: [], project: null }),
            ],
            totalCount: 2,
            nextOffset: null,
        }));
        vi.stubGlobal("fetch", fetchMock);

        render(<TaskViewBlock block={block({ viewType: "board", groupBy: "assignee" })} userId="actor-1" color="cyan" />);

        expect(await screen.findByText("Amina")).toBeVisible();
        expect(screen.getByText("Bilal")).toBeVisible();
        expect(screen.getByText("Unassigned")).toBeVisible();
        expect(screen.getAllByRole("link", { name: "Shared task" })).toHaveLength(2);
        expect(screen.getByText("2 loaded of 2 matching tasks")).toBeVisible();
        expect(screen.getAllByText("1 loaded")).toHaveLength(3);
    });

    it("renders grouping from a legacy filters.groupBy value", async () => {
        const fetchMock = vi.fn(async () => response({
            rows: [task("legacy-grouped")],
            totalCount: 1,
            nextOffset: null,
        }));
        vi.stubGlobal("fetch", fetchMock);

        render(<TaskViewBlock block={block({ viewType: "board", groupBy: undefined, filters: { groupBy: "assignee" } })} userId="actor-1" color="cyan" />);

        expect(await screen.findByText("Amina")).toBeVisible();
        expect(screen.queryByText("All tasks")).toBeNull();
    });

    it("treats a persisted project list as configured instead of silently showing setup required", async () => {
        const fetchMock = vi.fn(async () => response({ rows: [task("project-scoped")], totalCount: 1, nextOffset: null }));
        vi.stubGlobal("fetch", fetchMock);

        render(<TaskViewBlock block={block({ projectSelectionRequired: true, projectIds: ["project-1"] })} userId="actor-1" color="cyan" />);

        expect(await screen.findByRole("link", { name: "Task project-scoped" })).toBeVisible();
        expect(screen.queryByText(/setup required/i)).toBeNull();
        const fetchInput = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL] | undefined;
        const params = new URL(String(fetchInput?.[0] ?? ""), "http://localhost").searchParams;
        expect(params.getAll("projectIds")).toEqual(["project-1"]);
    });

    it("distinguishes first-page errors and recovers with retry", async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error("network down"))
            .mockResolvedValueOnce(response({ rows: [task("recovered")], totalCount: 1, nextOffset: null }));
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(<TaskViewBlock block={block()} userId="actor-1" color="cyan" />);
        expect(await screen.findByRole("alert")).toHaveTextContent(/could not load tasks/i);
        expect(screen.queryByText(/no tasks match/i)).toBeNull();

        await user.click(screen.getByRole("button", { name: "Retry" }));
        expect(await screen.findByRole("link", { name: "Task recovered" })).toBeVisible();
    });

    it("keeps loaded rows visible when Load more fails and retries that page", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({ rows: [task("one")], totalCount: 2, nextOffset: 1 }))
            .mockRejectedValueOnce(new Error("page failed"))
            .mockResolvedValueOnce(response({ rows: [task("two")], totalCount: 2, nextOffset: null }));
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(<TaskViewBlock block={block()} userId="actor-1" color="cyan" />);
        await screen.findByRole("link", { name: "Task one" });
        await user.click(screen.getByRole("button", { name: "Load more" }));
        expect(await screen.findByRole("alert")).toHaveTextContent(/could not load more tasks/i);
        expect(screen.getByRole("link", { name: "Task one" })).toBeVisible();

        await user.click(screen.getByRole("button", { name: "Retry load more" }));
        expect(await screen.findByRole("link", { name: "Task two" })).toBeVisible();
        expect(screen.queryByRole("button", { name: "Retry load more" })).toBeNull();
    });

    it("rejects malformed successful responses instead of rendering fake empty or exhausted success", async () => {
        const malformedResponses = [
            { rows: [{}], totalCount: 0, nextOffset: null },
            { rows: [], totalCount: -1, nextOffset: null },
            { rows: [], totalCount: 1 },
            { rows: [task("one")], totalCount: 1, nextOffset: 0 },
        ];

        for (const payload of malformedResponses) {
            const fetchMock = vi.fn(async () => response(payload));
            vi.stubGlobal("fetch", fetchMock);
            render(<TaskViewBlock block={block()} userId="actor-1" color="cyan" />);

            expect(await screen.findByRole("alert")).toHaveTextContent(/could not load tasks/i);
            expect(screen.queryByText(/no tasks match/i)).toBeNull();
            expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
            cleanup();
            vi.unstubAllGlobals();
        }
    });

    it("fences a stale response after the saved configuration changes", async () => {
        let resolveFirst: ((value: Response) => void) | undefined;
        const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
        const fetchMock = vi.fn()
            .mockReturnValueOnce(first)
            .mockResolvedValueOnce(response({ rows: [task("new", { title: "New filter task" })], totalCount: 1, nextOffset: null }));
        vi.stubGlobal("fetch", fetchMock);

        const { rerender } = render(<TaskViewBlock block={block({ filters: { status: "TODO" } })} userId="actor-1" color="cyan" />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        rerender(<TaskViewBlock block={block({ filters: { status: "DONE" } })} userId="actor-1" color="cyan" />);
        expect(await screen.findByRole("link", { name: "New filter task" })).toBeVisible();

        resolveFirst?.(response({ rows: [task("old", { title: "Stale old task" })], totalCount: 1, nextOffset: null }));
        await waitFor(() => expect(screen.queryByRole("link", { name: "Stale old task" })).toBeNull());
    });

    it("aborts pending Load more when the saved configuration changes and clears its loading state", async () => {
        let resolveStale: ((value: Response) => void) | undefined;
        const stale = new Promise<Response>((resolve) => { resolveStale = resolve; });
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({ rows: [task("initial")], totalCount: 2, nextOffset: 1 }))
            .mockReturnValueOnce(stale)
            .mockResolvedValueOnce(response({ rows: [task("replacement", { title: "Replacement task" })], totalCount: 1, nextOffset: null }));
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        const { rerender } = render(<TaskViewBlock block={block({ filters: { status: "TODO" } })} userId="actor-1" color="cyan" />);
        await screen.findByRole("link", { name: "Task initial" });
        await user.click(screen.getByRole("button", { name: "Load more" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        rerender(<TaskViewBlock block={block({ filters: { status: "DONE" } })} userId="actor-1" color="cyan" />);
        expect(await screen.findByRole("link", { name: "Replacement task" })).toBeVisible();
        expect((fetchMock.mock.calls[1]?.[1] as RequestInit).signal).toBeDefined();
        expect((fetchMock.mock.calls[1]?.[1] as RequestInit).signal).toHaveProperty("aborted", true);
        expect(screen.queryByRole("button", { name: "Loading more…" })).toBeNull();

        resolveStale?.(response({ rows: [task("stale-more", { title: "Stale load-more task" })], totalCount: 2, nextOffset: null }));
        await waitFor(() => expect(screen.queryByRole("link", { name: "Stale load-more task" })).toBeNull());
    });

    it("aborts pending Load more on unmount", async () => {
        let resolveMore: ((value: Response) => void) | undefined;
        const more = new Promise<Response>((resolve) => { resolveMore = resolve; });
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({ rows: [task("initial")], totalCount: 2, nextOffset: 1 }))
            .mockReturnValueOnce(more);
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        const view = render(<TaskViewBlock block={block()} userId="actor-1" color="cyan" />);
        await screen.findByRole("link", { name: "Task initial" });
        await user.click(screen.getByRole("button", { name: "Load more" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        view.unmount();
        expect((fetchMock.mock.calls[1]?.[1] as RequestInit).signal).toHaveProperty("aborted", true);
        resolveMore?.(response({ rows: [], totalCount: 2, nextOffset: null }));
    });

    it("does not pretend legacy gallery and timeline views are supported", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        render(<TaskViewBlock block={block({ viewType: "gallery" })} userId="actor-1" color="cyan" />);
        expect(screen.getByRole("status")).toHaveTextContent(/unsupported/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
