// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/components/sabah/test/setup";
import { createSavedViewSchema, updateSavedViewSchema } from "@/lib/saved-views/schemas";
import { BlockEditor } from "./block-editor";

vi.mock("./stat-tile-block-editor", () => ({
    StatTileBlockEditor: () => null,
}));

vi.mock("./chart-block-editor", () => ({
    ChartBlockEditor: () => null,
}));

vi.mock("./cover-picker", () => ({
    CoverPicker: ({ value }: { value: string | null }) => <button type="button">{value ? "Change cover" : "Add cover"}</button>,
    resolveCover: () => null,
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("BlockEditor aggregate block creation", () => {
    it("materializes compatible selectors before saving a new stat tile and chart", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(
            <BlockEditor
                viewId="view-1"
                viewName="Operations view"
                viewColor="cyan"
                viewIcon={null}
                initialBlocks={[]}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Add Block" }));
        await user.click(screen.getByRole("menuitem", { name: /Stat tile/i }));
        await user.click(screen.getByRole("button", { name: "Add Block" }));
        await user.click(screen.getByRole("menuitem", { name: /^Chart\b/i }));
        await user.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
            "/api/saved-views/view-1",
            expect.objectContaining({ method: "PATCH" }),
        ));

        const saveCall = fetchMock.mock.calls.find(([input]) => String(input) === "/api/saved-views/view-1");
        const requestBody = JSON.parse(String(saveCall?.[1]?.body)) as { blocksJson: string };
        const body = JSON.parse(requestBody.blocksJson) as { blocks: Array<Record<string, unknown>> };
        const stat = body.blocks.find((block) => block.type === "statTile");
        const chart = body.blocks.find((block) => block.type === "chart");

        expect(stat).toMatchObject({ type: "statTile", metric: "my-open" });
        expect(chart).toMatchObject({ type: "chart", chartKind: "task-by-status" });

        const blocksJson = JSON.stringify(body);
        expect(createSavedViewSchema.safeParse({
            name: "Created aggregate view",
            scope: "PERSONAL",
            blocksJson,
        }).success).toBe(true);
        expect(updateSavedViewSchema.safeParse({
            blocksJson,
            expectedUpdatedAt: "2026-10-08T00:00:00.000Z",
        }).success).toBe(true);
    });

    it("keeps the Sabah workspace configuration bounded and serializes it with the view", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(
            <BlockEditor
                viewId="view-sabah"
                viewName="Sabah Workspace"
                viewColor="cyan"
                viewIcon="sabah"
                initialBlocks={[]}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Add Block" }));
        await user.click(screen.getByRole("menuitem", { name: /Sabah workspace/i }));
        await user.click(screen.getByRole("radio", { name: /Focused dashboard/i }));
        await user.selectOptions(screen.getByRole("combobox", { name: /Accent palette/i }), "plum");
        await user.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
            "/api/saved-views/view-sabah",
            expect.objectContaining({ method: "PATCH" }),
        ));

        const saveCall = fetchMock.mock.calls.find(([input]) => String(input) === "/api/saved-views/view-sabah");
        const requestBody = JSON.parse(String(saveCall?.[1]?.body)) as { blocksJson: string };
        const body = JSON.parse(requestBody.blocksJson) as { blocks: Array<Record<string, unknown>> };
        expect(body.blocks.filter((block) => block.type === "assistantWorkspace")).toEqual([
            expect.objectContaining({ type: "assistantWorkspace", assistantLayout: "focused", assistantAccent: "plum" }),
        ]);
    });

    it("keeps the editor action row reachable as a full-width mobile group", () => {
        render(
            <BlockEditor
                viewId="view-mobile"
                viewName="Sabah Workspace"
                viewColor="cyan"
                viewIcon="sabah"
                initialBlocks={[]}
            />,
        );

        expect(screen.getByTestId("view-editor-actions")).toHaveClass("w-full");
        expect(screen.getByRole("button", { name: "Add cover" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Preview/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    });
});
