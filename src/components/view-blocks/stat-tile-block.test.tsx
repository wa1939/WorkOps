// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/components/sabah/test/setup";
import type { Block } from "./block-editor";
import { StatTileBlock } from "./stat-tile-block";

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function metric(value: number, key = "my-open", scope: "task" | "project" | "kpi" = "task") {
    return {
        kind: "metric",
        key,
        scope,
        value,
        totalCount: value,
        timeZone: "Asia/Riyadh",
    };
}

const block = (overrides: Partial<Block> = {}): Block => ({
    id: "stat-1",
    type: "statTile",
    metric: "my-open",
    ...overrides,
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("StatTileBlock aggregate integration", () => {
    it("uses the incumbent metric for a saved block without a selector", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(metric(4)));
        vi.stubGlobal("fetch", fetchMock);

        render(<StatTileBlock block={{ id: "saved-blank-stat", type: "statTile" }} activeChips={new Set()} />);

        expect(await screen.findByText("4")).toBeVisible();
        const params = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost").searchParams;
        expect(params.get("metric")).toBe("my-open");
    });

    it("treats an empty legacy metric as missing and uses the incumbent default", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(metric(5)));
        vi.stubGlobal("fetch", fetchMock);

        render(<StatTileBlock block={block({ metric: "" })} activeChips={new Set()} />);

        expect(await screen.findByText("5")).toBeVisible();
        const params = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost").searchParams;
        expect(params.get("metric")).toBe("my-open");
    });

    it("shows a bounded accessible error for an unsupported metric without fetching", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        render(<StatTileBlock block={block({ metric: "not-a-real-metric" })} activeChips={new Set()} />);

        expect(await screen.findByRole("alert")).toHaveTextContent(/unsupported metric/i);
        expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("contains a dual-selector contract error and does not call the provider", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        render(
            <StatTileBlock
                block={block({ metric: "my-open", chartKind: "task-by-status" })}
                activeChips={new Set()}
            />,
        );

        expect(await screen.findByRole("alert")).toHaveTextContent(/exactly one supported selector/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uses the server metric value and serializes transient task chips", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(metric(137)));
        vi.stubGlobal("fetch", fetchMock);

        render(<StatTileBlock block={block()} activeChips={new Set(["me", "high-priority"])} />);

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const metricUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
        expect(metricUrl.pathname).toBe("/api/views/aggregate");
        expect(metricUrl.searchParams.get("metric")).toBe("my-open");
        expect(metricUrl.searchParams.getAll("assigneeIds")).toEqual(["@me"]);
        expect(metricUrl.searchParams.getAll("priority")).toEqual(["HIGH", "URGENT"]);
        expect(await screen.findByText("137")).toBeVisible();
    });

    it("renders a server-provided zero as zero", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(metric(0)));
        vi.stubGlobal("fetch", fetchMock);

        render(<StatTileBlock block={block()} activeChips={new Set()} />);

        expect(await screen.findByText("0")).toBeVisible();
    });

    it("does not fetch when task chips conflict with the saved scope", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(metric(137)));
        vi.stubGlobal("fetch", fetchMock);

        render(
            <StatTileBlock
                block={block({ assigneeIds: ["user-2"] })}
                activeChips={new Set(["me"])}
            />,
        );

        expect(await screen.findByRole("alert")).toHaveTextContent(/cannot be combined|no tasks match/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not send task chips for KPI metrics", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(metric(5, "on-track-kpis", "kpi")));
        vi.stubGlobal("fetch", fetchMock);

        render(
            <StatTileBlock
                block={block({ metric: "on-track-kpis" })}
                activeChips={new Set(["me", "overdue", "high-priority"])}
            />,
        );

        await screen.findByText("5");
        const params = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost").searchParams;
        expect(Array.from(params.entries())).toEqual([["metric", "on-track-kpis"]]);
    });

    it("renders an error with retry instead of a fake empty value", async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error("network down"))
            .mockResolvedValueOnce(response(metric(7)));
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(<StatTileBlock block={block()} activeChips={new Set()} />);

        expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
        expect(screen.queryByText(/no data|—/i)).toBeNull();
        await user.click(screen.getByRole("button", { name: "Retry" }));
        expect(await screen.findByText("7")).toBeVisible();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
