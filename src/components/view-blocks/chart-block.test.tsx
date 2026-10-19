// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/components/sabah/test/setup";
import type { Block } from "./block-editor";
import { ChartBlock } from "./chart-block";

vi.mock("recharts", () => {
    const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        BarChart: passthrough,
        Bar: passthrough,
        PieChart: passthrough,
        Pie: passthrough,
        Cell: () => null,
        LineChart: passthrough,
        Line: passthrough,
        XAxis: () => null,
        YAxis: () => null,
        CartesianGrid: () => null,
        Tooltip: () => null,
        ResponsiveContainer: passthrough,
        Legend: () => null,
    };
});

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function chart(
    points: Array<{ key: string; label: string; value: number }>,
    key = "task-by-project",
) {
    return {
        kind: "chart",
        key,
        scope: "task",
        points,
        totalCount: points.reduce((sum, point) => sum + point.value, 0),
        timeZone: "Asia/Riyadh",
    };
}

const block = (overrides: Partial<Block> = {}): Block => ({
    id: "chart-1",
    type: "chart",
    chartKind: "task-by-project",
    title: "Work by project",
    ...overrides,
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("ChartBlock aggregate integration", () => {
    it("uses the incumbent chart kind for a saved block without a selector", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(chart([{ key: "todo", label: "Todo", value: 2 }], "task-by-status")));
        vi.stubGlobal("fetch", fetchMock);

        render(<ChartBlock block={{ id: "saved-blank-chart", type: "chart" }} activeChips={new Set()} />);

        expect(await screen.findByText("Todo")).toBeVisible();
        const params = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost").searchParams;
        expect(params.get("chartKind")).toBe("task-by-status");
    });

    it("treats an empty legacy chart kind as missing and uses the incumbent default", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(chart([{ key: "doing", label: "Doing", value: 3 }], "task-by-status")));
        vi.stubGlobal("fetch", fetchMock);

        render(<ChartBlock block={block({ chartKind: "" })} activeChips={new Set()} />);

        expect(await screen.findByText("Doing")).toBeVisible();
        const params = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost").searchParams;
        expect(params.get("chartKind")).toBe("task-by-status");
    });

    it("shows a bounded accessible error for an unsupported chart without fetching", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        render(<ChartBlock block={block({ chartKind: "not-a-real-chart" })} activeChips={new Set()} />);

        expect(await screen.findByRole("alert")).toHaveTextContent(/unsupported chart/i);
        expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("contains a dual-selector contract error and does not call the provider", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        render(
            <ChartBlock
                block={block({ chartKind: "task-by-status", metric: "my-open" })}
                activeChips={new Set()}
            />,
        );

        expect(await screen.findByRole("alert")).toHaveTextContent(/exactly one supported selector/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("renders duplicate labels as separate accessible table rows", async () => {
        const fetchMock = vi.fn(async () => response(chart([
            { key: "p1", label: "Same name", value: 4 },
            { key: "p2", label: "Same name", value: 3 },
        ])));
        vi.stubGlobal("fetch", fetchMock);

        render(<ChartBlock block={block()} activeChips={new Set()} />);

        const table = await screen.findByRole("table");
        expect(within(table).getByRole("columnheader", { name: "Category" })).toBeVisible();
        expect(within(table).getByRole("columnheader", { name: "Count" })).toBeVisible();
        expect(within(table).getAllByRole("cell", { name: "Same name" })).toHaveLength(2);
        expect(within(table).getAllByRole("row")).toHaveLength(3);
    });

    it("renders all fourteen server-ordered completion points", async () => {
        const points = Array.from({ length: 14 }, (_, index) => ({
            key: `2026-10-${String(index + 1).padStart(2, "0")}`,
            label: `2026-10-${String(index + 1).padStart(2, "0")}`,
            value: index,
        }));
        const fetchMock = vi.fn(async () => response(chart(points, "task-completion-trend")));
        vi.stubGlobal("fetch", fetchMock);

        render(<ChartBlock block={block({ chartKind: "task-completion-trend" })} activeChips={new Set()} />);

        const table = await screen.findByRole("table");
        const rows = within(table).getAllByRole("row").slice(1);
        expect(rows).toHaveLength(14);
        expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual(points.map((point) => point.label));
    });

    it("distinguishes an empty successful response from a rejected fetch", async () => {
        const fetchMock = vi.fn(async () => response(chart([])));
        vi.stubGlobal("fetch", fetchMock);

        render(<ChartBlock block={block()} activeChips={new Set()} />);

        await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/no results|empty/i));
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("renders an error with retry and never reports rejected data as empty", async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error("network down"))
            .mockResolvedValueOnce(response(chart([{ key: "p1", label: "Recovered", value: 2 }])));
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(<ChartBlock block={block()} activeChips={new Set()} />);

        expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
        expect(screen.queryByText(/no data/i)).toBeNull();
        await user.click(screen.getByRole("button", { name: "Retry" }));
        expect(await screen.findByText("Recovered")).toBeVisible();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("aborts and ignores a stale response after the block changes", async () => {
        let resolveStale: ((value: Response) => void) | undefined;
        const stale = new Promise<Response>((resolve) => { resolveStale = resolve; });
        const fetchMock = vi.fn()
            .mockReturnValueOnce(stale)
            .mockResolvedValueOnce(response(chart([{ key: "new", label: "New data", value: 1 }], "task-by-status")));
        vi.stubGlobal("fetch", fetchMock);

        const { rerender } = render(<ChartBlock block={block()} activeChips={new Set()} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        rerender(<ChartBlock block={block({ chartKind: "task-by-status" })} activeChips={new Set()} />);

        expect(await screen.findByText("New data")).toBeVisible();
        expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toHaveProperty("aborted", true);
        resolveStale?.(response(chart([{ key: "old", label: "Stale data", value: 9 }])));
        await waitFor(() => expect(screen.queryByText("Stale data")).toBeNull());
    });
});
