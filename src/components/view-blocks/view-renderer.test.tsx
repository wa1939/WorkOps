// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/components/sabah/test/setup";
import { SabahProvider } from "@/components/sabah/state/sabah-context";
import type { Block } from "./block-editor";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("./task-view-block", () => ({
    TaskViewBlock: ({ block, filterConflict }: { block: Block; filterConflict?: string | null }) => (
        <div data-testid={`task-view-${block.id}`}>
            {JSON.stringify({ assigneeIds: block.assigneeIds, priority: block.filters?.priority, dueRange: block.dueRange, filterConflict })}
        </div>
    ),
}));

vi.mock("./stat-tile-block", () => ({
    StatTileBlock: ({ block, activeChips, userId }: { block: Block; activeChips: ReadonlySet<string>; userId?: string }) => (
        <div data-testid={`stat-tile-${block.id}`}>
            {JSON.stringify({ activeChips: Array.from(activeChips).sort(), userId: userId ?? null })}
        </div>
    ),
}));

vi.mock("./chart-block", () => ({
    ChartBlock: ({ block, activeChips, userId }: { block: Block; activeChips: ReadonlySet<string>; userId?: string }) => (
        <div data-testid={`chart-${block.id}`}>
            {JSON.stringify({ activeChips: Array.from(activeChips).sort(), userId: userId ?? null })}
        </div>
    ),
}));

import { ViewRenderer } from "./view-renderer";

const view = {
    id: "view-1",
    name: "Operations view",
    description: "Work that matters",
    color: "cyan",
    icon: null,
    owner: null,
    hasVoted: false,
    voteCount: 0,
    isOwner: false,
};

const savedTaskBlock: Block = {
    id: "task-1",
    type: "taskView",
    viewType: "table",
    filters: { assigneeIds: "user-2", priority: "LOW" },
};

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("ViewRenderer quick filters", () => {
    it("passes the transient chip set to aggregate blocks without passing an actor id", async () => {
        const user = userEvent.setup();
        const blocks: Block[] = [
            { id: "stat-task", type: "statTile", metric: "my-open" },
            { id: "chart-task", type: "chart", chartKind: "task-by-status" },
            { id: "stat-kpi", type: "statTile", metric: "on-track-kpis" },
        ];
        render(<ViewRenderer view={view} blocks={blocks} userId="actor-1" />);

        await user.click(screen.getByRole("button", { name: "Me" }));
        await user.click(screen.getByRole("button", { name: "High Priority" }));
        await user.click(screen.getByRole("button", { name: "Overdue" }));

        expect(screen.getByTestId("stat-tile-stat-task")).toHaveTextContent(/high-priority/);
        expect(screen.getByTestId("chart-chart-task")).toHaveTextContent(/overdue/);
        expect(screen.getByTestId("stat-tile-stat-kpi")).toHaveTextContent(/me/);
        expect(screen.getByTestId("stat-tile-stat-task")).not.toHaveTextContent(/actor-1/);
        expect(screen.getByTestId("chart-chart-task")).not.toHaveTextContent(/actor-1/);
    });

    it("applies transient chips to task blocks, exposes pressed state, and leaves saved blocks unchanged", async () => {
        const user = userEvent.setup();
        const blocks: Block[] = [savedTaskBlock, { id: "copy", type: "text", content: "Keep me" }];
        render(<ViewRenderer view={view} blocks={blocks} userId="actor-1" />);

        const me = screen.getByRole("button", { name: "Me" });
        const overdue = screen.getByRole("button", { name: "Overdue" });
        const thisWeek = screen.getByRole("button", { name: "This Week" });
        const high = screen.getByRole("button", { name: "High Priority" });
        expect(me).toHaveAttribute("aria-pressed", "false");

        await user.click(me);
        expect(me).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByTestId("task-view-task-1")).toHaveTextContent(/filterConflict/);
        expect(screen.getByTestId("task-view-task-1")).toHaveTextContent(/cannot be combined|no tasks/i);
        expect(savedTaskBlock.assigneeIds).toBeUndefined();

        await user.click(high);
        expect(screen.getByTestId("task-view-task-1")).toHaveTextContent(/cannot be combined|no tasks/i);
        expect(high).toHaveAttribute("aria-pressed", "true");

        await user.click(overdue);
        expect(overdue).toHaveAttribute("aria-pressed", "true");
        await user.click(thisWeek);
        expect(overdue).toHaveAttribute("aria-pressed", "false");
        expect(thisWeek).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByText("Keep me")).toBeVisible();
    });
});

describe("ViewRenderer assistant workspace lifecycle", () => {
    it("renders exactly one workspace host and guidance for duplicate assistant IDs", () => {
        const duplicateView = { ...view, id: "view-duplicate-assistant", name: "Sabah view", description: null };
        const blocks: Block[] = [
            { id: "assistant-duplicate", type: "assistantWorkspace", assistantLayout: "focused" },
            { id: "assistant-duplicate", type: "assistantWorkspace", assistantLayout: "context" },
        ];

        render(
            <SabahProvider>
                <ViewRenderer view={duplicateView} blocks={blocks} userId="actor-1" />
            </SabahProvider>,
        );

        expect(screen.getAllByTestId("sabah-workspace-assistant-duplicate")).toHaveLength(1);
        expect(document.querySelectorAll('[data-sabah-host="sabah-assistant-duplicate"]')).toHaveLength(1);
        expect(screen.getByRole("note")).toHaveTextContent(/already includes a Sabah workspace/i);
        expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
    });

    it("keeps the Sabah cover perceptible and puts secondary saved-view actions behind a mobile menu", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            if (String(input).includes("/api/home-preference")) return new Response(JSON.stringify({ viewId: null }), { status: 200 });
            return new Response(JSON.stringify({}), { status: 200 });
        });
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();
        const sabahView = {
            ...view,
            id: "view-sabah",
            name: "Sabah Workspace",
            description: "Your personal daily work surface",
            icon: "sabah",
            owner: { id: "actor-1", name: "Agent QA", image: null },
            isOwner: true,
        };

        render(
            <SabahProvider>
                <ViewRenderer
                    view={sabahView}
                    blocks={[{ id: "assistant-1", type: "assistantWorkspace", assistantLayout: "context", assistantAccent: "sky" }]}
                    cover="grad-midnight"
                    userId="actor-1"
                />
            </SabahProvider>,
        );

        expect(screen.getByTestId("sabah-view-heading")).toHaveAttribute("data-cover-selected", "true");
        expect(screen.getByRole("heading", { name: "Sabah Workspace" })).toBeVisible();
        const actions = screen.getByRole("button", { name: "View actions" });
        expect(actions).toBeVisible();

        await user.click(actions);
        expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/views/view-sabah/edit");
        expect(screen.getAllByRole("button", { name: "Make my home" }).length).toBeGreaterThan(0);
        expect(screen.getAllByRole("button", { name: "Restore default" }).length).toBeGreaterThan(0);
    });
});
