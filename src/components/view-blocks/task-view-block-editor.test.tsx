// @vitest-environment jsdom
import React, { useState } from "react";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/components/sabah/test/setup";
import { TaskViewBlockEditor } from "./task-view-block-editor";
import type { Block } from "./block-editor";
import { createSavedViewSchema, updateSavedViewSchema } from "@/lib/saved-views/schemas";

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

const baseBlock: Block = {
    id: "editor-task",
    type: "taskView",
    viewType: "gallery",
    filters: { status: "TODO", legacyKey: "preserve-me" },
    assigneeIds: ["user-1"],
    projectIds: ["project-1"],
    tagIds: ["tag-old"],
    dueRange: "today",
    sortBy: "dueAt",
    sortDir: "desc",
    groupBy: "status",
    projectSelectionRequired: true,
};

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("TaskViewBlockEditor", () => {
    it("keeps legacy fields while exposing a truthful migration state and controls", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === "/api/users") return response([{ id: "user-1", name: "Amina", email: "a@example.com" }, { id: "user-2", name: "Bilal" }]);
            if (url === "/api/projects") return response([{ id: "project-1", name: "Project Alpha" }, { id: "project-2", name: "Project Beta" }]);
            if (url === "/api/tags") return response([{ id: "tag-1", name: "Release" }, { id: "tag-2", name: "Bug" }]);
            return response([]);
        }));
        const updates: Block[] = [];
        const user = userEvent.setup();
        function ControlledEditor() {
            const [value, setValue] = useState(baseBlock);
            return <TaskViewBlockEditor block={value} onUpdate={(next) => { updates.push(next); setValue(next); }} />;
        }

        render(<ControlledEditor />);

        expect(screen.getByRole("alert")).toHaveTextContent(/unsupported.*gallery/i);
        expect(screen.queryByRole("status")).toBeNull();
        expect(screen.getByRole("button", { name: "Board" })).toBeVisible();
        expect(screen.getByRole("button", { name: "Table" })).toBeVisible();
        expect(screen.getByRole("button", { name: "Calendar" })).toBeVisible();

        await waitFor(() => expect(screen.getByLabelText("Me")).toBeVisible());
        await user.click(screen.getByLabelText("Me"));
        await user.click(screen.getByLabelText("Bilal"));
        await user.click(screen.getByLabelText("Bug"));
        await user.selectOptions(screen.getByLabelText("Project filter"), "project-2");
        await user.selectOptions(screen.getByLabelText("Date range"), "this-week");
        await user.selectOptions(screen.getByLabelText("Group tasks by"), "assignee");
        await user.selectOptions(screen.getByLabelText("Sort tasks by"), "dueDate");
        await user.selectOptions(screen.getByLabelText("Sort direction"), "asc");
        await user.click(screen.getByRole("button", { name: "Table" }));

        const last = updates.at(-1);
        expect(last).toMatchObject({
            id: "editor-task",
            type: "taskView",
            viewType: "table",
            projectId: "project-2",
            dueRange: "this-week",
            groupBy: "assignee",
            sortBy: "dueDate",
            sortDir: "asc",
            projectSelectionRequired: true,
            filters: { status: "TODO", legacyKey: "preserve-me" },
        });
        expect(last?.assigneeIds).toEqual(["user-1", "@me", "user-2"]);
        expect(last?.tagIds).toEqual(["tag-old", "tag-2"]);
        expect(last?.projectIds).toBeUndefined();
    });

    it("does not overwrite persisted IDs when option endpoints fail", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("selector unavailable"); }));
        const updates: Block[] = [];
        const user = userEvent.setup();
        function ControlledEditor() {
            const [value, setValue] = useState(baseBlock);
            return <TaskViewBlockEditor block={value} onUpdate={(next) => { updates.push(next); setValue(next); }} />;
        }

        render(<ControlledEditor />);
        await screen.findByRole("alert", { name: /could not load/i });
        expect(screen.getByLabelText("Project filter")).toHaveValue("project-1");
        await user.click(screen.getByRole("button", { name: "Calendar" }));

        expect(updates.at(-1)).toMatchObject({
            assigneeIds: ["user-1"],
            projectIds: ["project-1"],
            tagIds: ["tag-old"],
            filters: { status: "TODO", legacyKey: "preserve-me" },
        });
    });

    it("keeps legacy list filters schema-compatible and replaces old project lists", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === "/api/users") return response([{ id: "user-2", name: "Bilal" }]);
            if (url === "/api/projects") return response([{ id: "project-1", name: "Project Alpha" }, { id: "project-2", name: "Project Beta" }]);
            if (url === "/api/tags") return response([{ id: "tag-2", name: "Bug" }]);
            return response([]);
        }));
        const updates: Block[] = [];
        const legacyBlock: Block = {
            id: "legacy-editor-task",
            type: "taskView",
            viewType: "table",
            filters: {
                status: "TODO",
                assigneeIds: "user-1",
                tagIds: "tag-old",
                projectIds: "project-1,project-2",
                legacyKey: "preserve-me",
            },
            projectIds: ["project-1", "project-2"],
            projectSelectionRequired: true,
        };
        const user = userEvent.setup();
        function ControlledEditor() {
            const [value, setValue] = useState(legacyBlock);
            return <TaskViewBlockEditor block={value} onUpdate={(next) => { updates.push(next); setValue(next); }} />;
        }

        render(<ControlledEditor />);

        expect(screen.queryByRole("status")).toBeNull();
        await waitFor(() => expect(screen.getByLabelText("Me")).toBeVisible());
        expect(screen.getByLabelText("Project filter")).toHaveValue("__multiple__");

        await user.click(screen.getByLabelText("Me"));
        await user.click(screen.getByLabelText("Bilal"));
        await user.click(screen.getByLabelText("Bug"));
        await user.selectOptions(screen.getByLabelText("Project filter"), "project-2");

        const last = updates.at(-1);
        expect(last?.filters).toEqual({
            status: "TODO",
            assigneeIds: "user-1,@me,user-2",
            tagIds: "tag-old,tag-2",
            legacyKey: "preserve-me",
        });
        expect(last?.projectId).toBe("project-2");
        expect(last?.projectIds).toBeUndefined();
        expect(last?.projectSelectionRequired).toBe(true);

        if (!last) throw new Error("Expected the editor to emit an updated block.");
        const blocksJson = JSON.stringify({ blocks: [last] });
        expect(createSavedViewSchema.safeParse({ name: "Edited legacy view", scope: "PERSONAL", blocksJson }).success).toBe(true);
        expect(updateSavedViewSchema.safeParse({ blocksJson, expectedUpdatedAt: "2026-10-08T00:00:00.000Z" }).success).toBe(true);
    });

    it("shows persisted dueAt using the canonical Due date control without rewriting it", () => {
        const updates: Block[] = [];

        render(<TaskViewBlockEditor block={baseBlock} onUpdate={(next) => updates.push(next)} />);

        expect(screen.getByLabelText("Sort tasks by")).toHaveValue("dueDate");
        expect(updates).toHaveLength(0);
    });

    it("gives repeated task editors unique control ids", () => {
        const { container } = render(
            <>
                <TaskViewBlockEditor block={{ ...baseBlock, id: "first" }} onUpdate={() => undefined} />
                <TaskViewBlockEditor block={{ ...baseBlock, id: "second" }} onUpdate={() => undefined} />
            </>,
        );

        const ids = Array.from(container.querySelectorAll("[id]"), (element) => element.id)
            .filter((id) => id.startsWith("task-view-"));
        expect(ids.length).toBeGreaterThan(0);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
