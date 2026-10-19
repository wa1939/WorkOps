// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import "./test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import { SabahProvider, useSabah } from "./state/sabah-context";
import { SabahCopilot } from "./sabah-copilot";
vi.mock("./client", async (original) => ({ ...await original<typeof import("./client")>(), createSabahClient: () => ({ listWorkflows: async () => [] }) }));
function Probe() { return <span data-testid="recovered-conversation">{useSabah().state.conversationId ?? "none"}</span>; }
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
it("recovers the saved conversation under StrictMode effect replay without clearing its id", async () => {
    localStorage.setItem("sabah:activeConversation", "conversation-saved");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 })));
    render(<React.StrictMode><SabahProvider><SabahCopilot /><Probe /></SabahProvider></React.StrictMode>);
    await waitFor(() => expect(screen.getByTestId("recovered-conversation")).toHaveTextContent("conversation-saved"));
    expect(localStorage.getItem("sabah:activeConversation")).toBe("conversation-saved");
});
