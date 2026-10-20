// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    TaskWorkspaceToolbar,
    type TaskWorkspaceFilterState,
} from "./TaskWorkspaceToolbar";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

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

const BASE_FILTERS: TaskWorkspaceFilterState = {
    scope: "assigned",
    assigneeIds: [],
    status: [],
    priority: [],
    search: "",
    due: "",
    sortBy: "updatedAt",
    dir: "desc",
};

function renderToolbar(overrides: Partial<TaskWorkspaceFilterState> = {}) {
    const onChange = vi.fn();
    const onClear = vi.fn();
    const onViewChange = vi.fn();
    render(
        <TaskWorkspaceToolbar
            filters={{ ...BASE_FILTERS, ...overrides }}
            onChange={onChange}
            onClear={onClear}
            view="list"
            onViewChange={onViewChange}
        />,
    );
    return { onChange, onClear, onViewChange };
}

function lastChange(onChange: ReturnType<typeof vi.fn>): Record<string, unknown> {
    const call = onChange.mock.calls.at(-1);
    return (call?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(USERS)));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("TaskWorkspaceToolbar", () => {
    it("marks My tasks as the active default scope", () => {
        renderToolbar();
        expect(screen.getByRole("button", { name: "My tasks" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "All tasks" })).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByRole("button", { name: "Related to me" })).toHaveAttribute("aria-pressed", "false");
    });

    it("loads the full active user list into the person picker", async () => {
        renderToolbar();
        const person = screen.getByLabelText("Person") as HTMLSelectElement;
        await waitFor(() => expect(person.options.length).toBe(USERS.length + 1));
        expect(USERS.every((user) => person.textContent.includes(user.name))).toBe(true);
    });

    it("selecting a person switches scope to all with that assignee", async () => {
        const { onChange } = renderToolbar();
        const person = screen.getByLabelText("Person") as HTMLSelectElement;
        await waitFor(() => expect(person.options.length).toBe(USERS.length + 1));
        await userEvent.selectOptions(person, "user-2");
        expect(lastChange(onChange)).toEqual({ scope: "all", assigneeIds: ["user-2"] });
    });

    it("choosing My tasks clears selected assignees", async () => {
        const { onChange } = renderToolbar({ scope: "all", assigneeIds: ["user-2"] });
        await userEvent.click(screen.getByRole("button", { name: "My tasks" }));
        expect(lastChange(onChange)).toEqual({ scope: "assigned", assigneeIds: [] });
    });

    it("keeps the toolbar usable when the users request fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Failed to fetch users" }, 500)));
        renderToolbar();
        const person = screen.getByLabelText("Person") as HTMLSelectElement;
        await waitFor(() => expect(person).toBeDisabled());
        expect(screen.getByRole("button", { name: "My tasks" })).toBeEnabled();
        expect(screen.getByLabelText("Search tasks")).toBeEnabled();
    });

    it("shows a disabled person picker when the users request rejects", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new Error("network down");
        }));
        renderToolbar();
        await waitFor(() => expect(screen.getByLabelText("Person")).toBeDisabled());
    });

    it("offers Created by me and Unassigned in the extra scope select", async () => {
        const { onChange } = renderToolbar();
        await userEvent.selectOptions(screen.getByLabelText("More scopes"), "unassigned");
        expect(lastChange(onChange)).toEqual({ scope: "unassigned" });
    });

    it("reports status, priority and due preset changes", async () => {
        const { onChange } = renderToolbar();
        await userEvent.selectOptions(screen.getByLabelText("Status"), "DOING");
        expect(lastChange(onChange)).toEqual({ status: ["DOING"] });
        await userEvent.selectOptions(screen.getByLabelText("Priority"), "HIGH");
        expect(lastChange(onChange)).toEqual({ priority: ["HIGH"] });
        await userEvent.selectOptions(screen.getByLabelText("Due"), "today");
        expect(lastChange(onChange)).toEqual({ due: "today" });
    });

    it("reports sort field and direction changes", async () => {
        const { onChange } = renderToolbar();
        await userEvent.selectOptions(screen.getByLabelText("Sort by"), "dueDate");
        expect(lastChange(onChange)).toEqual({ sortBy: "dueDate" });
        await userEvent.selectOptions(screen.getByLabelText("Direction"), "asc");
        expect(lastChange(onChange)).toEqual({ dir: "asc" });
    });

    it("submits the search draft through the URL patch", async () => {
        const { onChange } = renderToolbar();
        await userEvent.type(screen.getByLabelText("Search tasks"), "invoice{enter}");
        expect(lastChange(onChange)).toEqual({ search: "invoice" });
    });

    it("Clear filters is offered once filters are active", async () => {
        const { onClear } = renderToolbar({ search: "invoice" });
        await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it("links New Task to the task creation form", () => {
        renderToolbar();
        expect(screen.getByRole("link", { name: "New Task" })).toHaveAttribute("href", "/tasks/new");
    });

    it("reports view toggle changes with pressed state", async () => {
        const { onViewChange } = renderToolbar();
        await userEvent.click(screen.getByRole("button", { name: "Board" }));
        expect(onViewChange).toHaveBeenCalledWith("board");
        expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    });
});
