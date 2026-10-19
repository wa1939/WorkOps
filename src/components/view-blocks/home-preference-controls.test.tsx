// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../sabah/test/setup";
import { HomePreferenceControls } from "./home-preference-controls";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("home preference controls", () => {
    it("sets an accessible view as home and restores the dashboard default", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === "PUT") return new Response(JSON.stringify({ viewId: "view-sabah" }), { status: 200 });
            if (init?.method === "DELETE") return new Response(JSON.stringify({ viewId: null }), { status: 200 });
            return new Response(JSON.stringify({ viewId: null }), { status: 200 });
        });
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(<HomePreferenceControls viewId="view-sabah" />);
        const makeHome = await screen.findByRole("button", { name: "Make my home" });
        await user.click(makeHome);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/home-preference", expect.objectContaining({ method: "PUT" })));
        expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ viewId: "view-sabah" });

        await user.click(await screen.findByRole("button", { name: "Restore default" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/home-preference", expect.objectContaining({ method: "DELETE" })));
    });
});
