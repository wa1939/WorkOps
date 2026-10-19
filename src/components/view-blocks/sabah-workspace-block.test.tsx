// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "../sabah/test/setup";
import { SabahWorkspaceBlock } from "./sabah-workspace-block";

vi.mock("@/components/sabah/sabah-host", () => ({
    SabahWorkspaceHost: ({ hostId, className }: { hostId: string; className?: string }) => <div data-testid={`host-${hostId}`} className={className} />,
}));

vi.mock("./sabah-daily-dashboard", () => ({
    SabahDailyDashboard: ({ blockId, layout, viewId }: { blockId: string; layout?: string; viewId?: string }) => <><div data-testid={`mock-dashboard-${blockId}`} data-layout={layout} data-view-id={viewId} /><div data-testid={`host-sabah-${blockId}`} /></>,
}));

const block = {
    id: "assistant-1",
    type: "assistantWorkspace" as const,
    assistantLayout: "context" as const,
    assistantAccent: "plum" as const,
};

describe("Sabah workspace view block", () => {
    it("renders one compact dashboard with the persisted context layout", () => {
        render(<SabahWorkspaceBlock block={block} userId="actor-1" viewColor="cyan" viewId="view-1" />);

        expect(screen.getByTestId("sabah-workspace-assistant-1")).toHaveAttribute("data-assistant-layout", "context");
        expect(screen.getByTestId("sabah-workspace-assistant-1")).toHaveAttribute("data-assistant-accent", "plum");
        expect(screen.getByTestId("host-sabah-assistant-1")).toBeInTheDocument();
        expect(screen.getByTestId("mock-dashboard-assistant-1")).toHaveAttribute("data-layout", "context");
        expect(screen.getByTestId("mock-dashboard-assistant-1")).toHaveAttribute("data-view-id", "view-1");
        expect(screen.queryByTestId("sabah-live-context-assistant-1")).not.toBeInTheDocument();
    });

    it("removes the context rail when the view is configured as focused", () => {
        render(<SabahWorkspaceBlock block={{ ...block, assistantLayout: "focused" }} userId="actor-1" viewColor="cyan" viewId="view-1" />);

        expect(screen.getByTestId("sabah-workspace-assistant-1")).toHaveAttribute("data-assistant-layout", "focused");
        expect(screen.queryByTestId("sabah-live-context-assistant-1")).not.toBeInTheDocument();
        expect(screen.getByTestId("mock-dashboard-assistant-1")).toHaveAttribute("data-layout", "focused");
    });
});
