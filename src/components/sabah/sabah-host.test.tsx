// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import "./test/setup";
import { SabahProvider, useSabah } from "./state/sabah-context";
import { SabahWorkspaceHost } from "./sabah-host";

function Probe() {
    const { activeHost, state, dispatch } = useSabah();
    return (
        <>
            <output data-testid="active-host">{activeHost?.id ?? "none"}</output>
            <output data-testid="conversation">{state.conversationId ?? "none"}</output>
            <button type="button" onClick={() => dispatch({ type: "CONVERSATION_SWITCHED", conversationId: "conversation-kept" })}>
                Seed conversation
            </button>
        </>
    );
}

function Harness({ hosts }: { hosts: string[] }) {
    return (
        <SabahProvider>
            <Probe />
            {hosts.map((hostId) => <SabahWorkspaceHost key={hostId} hostId={hostId} />)}
        </SabahProvider>
    );
}

describe("Sabah workspace host bridge", () => {
    it("keeps one active replacement host and preserves provider conversation state", async () => {
        const { rerender } = render(<Harness hosts={["view-a", "view-b"]} />);
        await waitFor(() => expect(screen.getByTestId("active-host")).toHaveTextContent("view-b"));

        await act(async () => {
            screen.getByRole("button", { name: "Seed conversation" }).click();
        });
        expect(screen.getByTestId("conversation")).toHaveTextContent("conversation-kept");

        rerender(<Harness hosts={["view-a"]} />);
        await waitFor(() => expect(screen.getByTestId("active-host")).toHaveTextContent("view-a"));
        expect(screen.getByTestId("conversation")).toHaveTextContent("conversation-kept");

        rerender(<Harness hosts={[]} />);
        await waitFor(() => expect(screen.getByTestId("active-host")).toHaveTextContent("none"));
    });
});
