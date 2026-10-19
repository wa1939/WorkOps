// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import "./test/setup";
import { render, screen } from "@testing-library/react";
import { SabahEntry } from "./sabah-entry";

vi.mock("./sabah-copilot", () => ({
    SabahCopilot: () => {
        // Mark presence via a testid only the adaptive copilot renders.
        return <div data-testid="adaptive-copilot" />;
    },
}));

vi.mock("./state/sabah-context", () => ({
    SabahProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="sabah-provider">{children}</div>,
    useSabah: () => ({ activeHost: null }),
}));

const ChatWidgetMock = () => <div data-testid="legacy-chat-widget" />;
vi.mock("@/components/ai-chat/chat-widget", () => ({
    ChatWidget: () => <ChatWidgetMock />,
}));

describe("SabahEntry flag switch", () => {
    it("renders the legacy ChatWidget when the platform flag is false", () => {
        render(<SabahEntry platformEnabled={false} />);
        expect(screen.getByTestId("legacy-chat-widget")).toBeInTheDocument();
        expect(screen.queryByTestId("adaptive-copilot")).not.toBeInTheDocument();
    });

    it("renders the Adaptive Copilot when the platform flag is true", () => {
        render(<SabahEntry platformEnabled={true} />);
        expect(screen.getByTestId("adaptive-copilot")).toBeInTheDocument();
        expect(screen.queryByTestId("legacy-chat-widget")).not.toBeInTheDocument();
    });
});
