// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { duePresetToRange, TaskViewSwitcher } from "./TaskViewSwitcher";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const navState = vi.hoisted(() => ({ search: "" }));
const routerMocks = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: routerMocks.replace, push: routerMocks.push, refresh: vi.fn() }),
    usePathname: () => "/tasks",
    useSearchParams: () => new URLSearchParams(navState.search),
}));

vi.mock("./board/Board", () => ({
    Board: (props: { filters?: unknown }) =>
        React.createElement("div", {
            "data-testid": "board-mock",
            "data-filters": JSON.stringify(props.filters ?? null),
        }),
}));

vi.mock("./grid/TaskGrid", () => ({
    TaskGrid: (props: { filters?: unknown }) =>
        React.createElement("div", {
            "data-testid": "grid-mock",
            "data-filters": JSON.stringify(props.filters ?? null),
        }),
}));

const USERS = [
    { id: "user-1", name: "A. Member", email: "a@example.test" },
    { id: "user-2", name: "B. Member", email: "b@example.test" },
];

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function renderSwitcher(search = "") {
    navState.search = search;
    return render(<TaskViewSwitcher />);
}

function lastUrl(): string {
    const call = routerMocks.replace.mock.calls.at(-1);
    return typeof call?.[0] === "string" ? call[0] : "";
}

function filtersOf(node: HTMLElement): Record<string, unknown> {
    return JSON.parse(node.getAttribute("data-filters") ?? "null") as Record<string, unknown>;
}

beforeEach(() => {
    navState.search = "";
    routerMocks.replace.mockClear();
    routerMocks.push.mockClear();
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/users") return jsonResponse(USERS);
        return jsonResponse({ error: "Not found" }, 404);
    }));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("TaskViewSwitcher", () => {
    it("uses Riyadh calendar boundaries regardless of the browser timezone", () => {
        const now = new Date("2026-10-20T22:30:00.000Z");
        expect(duePresetToRange("today", now)).toEqual({
            dueAfter: "2026-10-20T21:00:00.000Z",
            dueBefore: "2026-10-21T20:59:59.999Z",
        });
        expect(duePresetToRange("overdue", now)).toEqual({ dueBefore: "2026-10-20T20:59:59.999Z" });
        expect(duePresetToRange("week", now)).toEqual({
            dueAfter: "2026-10-20T21:00:00.000Z",
            dueBefore: "2026-10-27T20:59:59.999Z",
        });
    });

    it("merges filter changes while earlier URL replacements are pending", async () => {
        const rendered = renderSwitcher("");
        await userEvent.selectOptions(await screen.findByLabelText("Status"), "DOING");
        const firstQuery = lastUrl().split("?")[1];
        await userEvent.selectOptions(screen.getByLabelText("Priority"), "HIGH");
        expect(lastUrl()).toContain("status=DOING");
        expect(lastUrl()).toContain("priority=HIGH");
        navState.search = firstQuery;
        rendered.rerender(<TaskViewSwitcher />);
        await userEvent.click(screen.getByRole("button", { name: "Board" }));
        expect(lastUrl()).toContain("status=DOING");
        expect(lastUrl()).toContain("priority=HIGH");
        expect(lastUrl()).toContain("view=board");
    });

    it("clears a legacy singular person alias when selecting My tasks", async () => {
        renderSwitcher("scope=all&assigneeId=user-1&view=board");
        await screen.findByTestId("board-mock");
        await userEvent.click(screen.getByRole("button", { name: "My tasks" }));
        expect(lastUrl()).toBe("/tasks?view=board");
    });

    it("URL view wins over the saved localStorage view", async () => {
        window.localStorage.setItem("tasks-view", "list");
        renderSwitcher("view=board");
        expect(await screen.findByTestId("board-mock")).toBeInTheDocument();
    });

    it("falls back to the saved localStorage view when the URL has none", async () => {
        window.localStorage.setItem("tasks-view", "board");
        renderSwitcher("");
        expect(await screen.findByTestId("board-mock")).toBeInTheDocument();
    });

    it("keeps switching views when localStorage denies writes", async () => {
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("QuotaExceededError");
        });
        renderSwitcher("");
        await screen.findByTestId("grid-mock");
        await userEvent.click(screen.getByRole("button", { name: "Board" }));
        expect(await screen.findByTestId("board-mock")).toBeInTheDocument();
    });

    it("toggling the view keeps every filter parameter", async () => {
        renderSwitcher("scope=related&search=deadline&due=today");
        await screen.findByTestId("grid-mock");
        await userEvent.click(screen.getByRole("button", { name: "Board" }));
        const url = lastUrl();
        for (const fragment of ["view=board", "scope=related", "search=deadline", "due=today"]) {
            expect(url).toContain(fragment);
        }
    });

    it("passes the default My tasks scope to both views without assignees", async () => {
        renderSwitcher("");
        const gridFilters = filtersOf(await screen.findByTestId("grid-mock"));
        expect(gridFilters).toEqual(expect.objectContaining({ scope: "assigned" }));
        expect(gridFilters.assigneeIds).toEqual([]);
        await userEvent.click(screen.getByRole("button", { name: "Board" }));
        expect(filtersOf(await screen.findByTestId("board-mock")))
            .toEqual(expect.objectContaining({ scope: "assigned" }));
    });

    it("keeps chosen people only for the All tasks scope", async () => {
        renderSwitcher("scope=all&assigneeIds=user-1&assigneeIds=user-2");
        const gridFilters = filtersOf(await screen.findByTestId("grid-mock"));
        expect(gridFilters).toEqual(expect.objectContaining({
            scope: "all",
            assigneeIds: ["user-1", "user-2"],
        }));

        cleanup();
        renderSwitcher("scope=related&assigneeIds=user-1");
        const relatedFilters = filtersOf(await screen.findByTestId("grid-mock"));
        expect(relatedFilters.scope).toBe("related");
        expect(relatedFilters.assigneeIds).toEqual([]);
    });

    it("converts due presets into ISO bounds for the query", async () => {
        renderSwitcher("due=today");
        const todayFilters = filtersOf(await screen.findByTestId("grid-mock"));
        expect(typeof todayFilters.dueAfter).toBe("string");
        expect(typeof todayFilters.dueBefore).toBe("string");
        expect(new Date(String(todayFilters.dueAfter)).toString()).not.toBe("Invalid Date");
        expect(new Date(String(todayFilters.dueBefore)).toString()).not.toBe("Invalid Date");

        cleanup();
        renderSwitcher("due=overdue");
        const overdueFilters = filtersOf(await screen.findByTestId("grid-mock"));
        expect(typeof overdueFilters.dueBefore).toBe("string");
        expect(overdueFilters.dueAfter).toBeUndefined();
    });

    it("Clear filters resets filter params while keeping the view", async () => {
        renderSwitcher("scope=related&status=DOING&priority=HIGH&search=x&due=today&sortBy=title&dir=asc&view=board");
        await screen.findByTestId("board-mock");
        await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
        expect(lastUrl()).toBe("/tasks?view=board");
    });

    it("selecting My tasks drops the assignee filter from the URL", async () => {
        renderSwitcher("scope=all&assigneeIds=user-1&view=board");
        await screen.findByTestId("board-mock");
        await userEvent.click(screen.getByRole("button", { name: "My tasks" }));
        expect(lastUrl()).toBe("/tasks?view=board");
    });

    it("selecting a person moves the URL to the All tasks scope", async () => {
        renderSwitcher("scope=assigned");
        await screen.findByTestId("grid-mock");
        const person = await screen.findByLabelText("Person");
        await userEvent.selectOptions(person, "user-2");
        const url = lastUrl();
        expect(url).toContain("scope=all");
        expect(url).toContain("assigneeIds=user-2");
    });

    it("leaves sortBy and dir in the URL for the backend", async () => {
        renderSwitcher("sortBy=dueDate&dir=asc");
        await screen.findByTestId("grid-mock");
        await userEvent.click(screen.getByRole("button", { name: "Board" }));
        const url = lastUrl();
        expect(url).toContain("sortBy=dueDate");
        expect(url).toContain("dir=asc");
        expect(filtersOf(screen.getByTestId("board-mock")).sortBy).toBeUndefined();
    });
});
