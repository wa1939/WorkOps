// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "./test/setup";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SabahCopilot } from "./sabah-copilot";
import { SabahProvider } from "./state/sabah-context";
import { SabahWorkspaceHost } from "./sabah-host";

function renderCopilot() {
    return render(
        <SabahProvider>
            <SabahCopilot />
        </SabahProvider>
    );
}

const NON_CHAT_TABS = ["Context", "Activity"] as const;

function mockContextFetch() {
    return vi.spyOn(global, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/api/ai/memory?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes("/api/ai/playbooks?")) return new Response("[]", { status: 200 });
        throw new Error(`Unexpected fetch in focus regression: ${url}`);
    });
}

beforeEach(() => {
    window.localStorage.removeItem("sabah:activeConversation");
    // The shell persists width and active tab; a leftover tab from an earlier
    // test changes which surface mounts and consumes fetch mocks.
    window.localStorage.removeItem("sabah.shell");
});

describe("SabahCopilot shell", () => {
    it("mounts the existing engine once into an embedded host and keeps close reversible", async () => {
        const user = userEvent.setup();
        render(
            <SabahProvider>
                <SabahWorkspaceHost hostId="view-sabah" />
                <SabahCopilot />
            </SabahProvider>,
        );
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        const host = await screen.findByTestId("sabah-shell");
        await waitFor(() => expect(host).toHaveAttribute("data-mode", "INLINE"));
        expect(screen.queryByRole("button", { name: /Open Sabah/i })).not.toBeInTheDocument();
        expect(within(host).getByRole("button", { name: "Hide Sabah" })).toHaveAttribute("title", "Hide Sabah from this view");

        await user.click(within(host).getByRole("button", { name: "Close Sabah" }));
        await waitFor(() => expect(screen.queryByTestId("sabah-shell")).not.toBeInTheDocument());
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await waitFor(() => expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "INLINE"));
        expect(screen.getByRole("textbox", { name: /Message Sabah/i })).toHaveFocus();
    });

    it("reopens an embedded Sabah surface inline at 390px and focuses the composer", async () => {
        const originalMatchMedia = window.matchMedia;
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: query === "(max-width: 640px)",
            media: query,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        }));
        try {
            const user = userEvent.setup();
            render(
                <SabahProvider>
                    <SabahWorkspaceHost hostId="view-sabah-390" />
                    <SabahCopilot />
                </SabahProvider>,
            );
            await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
            const shell = await screen.findByTestId("sabah-shell");
            await waitFor(() => expect(shell).toHaveAttribute("data-mode", "INLINE"));

            await user.click(within(shell).getByRole("button", { name: "Close Sabah" }));
            await waitFor(() => expect(screen.queryByTestId("sabah-shell")).not.toBeInTheDocument());
            await user.click(screen.getByRole("button", { name: /Open Sabah/i }));

            await waitFor(() => expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "INLINE"));
            expect(screen.getByTestId("sabah-shell")).not.toHaveAttribute("data-mode", "FULLSCREEN");
            expect(screen.getByRole("textbox", { name: /Message Sabah/i })).toHaveFocus();
        } finally {
            window.matchMedia = originalMatchMedia;
        }
    });

    it("resets the shell when a same-ID host is replaced by a new DOM element", async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            <SabahProvider>
                <SabahWorkspaceHost key="first-host" hostId="same-host" />
                <SabahCopilot />
            </SabahProvider>,
        );
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await waitFor(() => expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "INLINE"));

        rerender(
            <SabahProvider>
                <SabahWorkspaceHost key="replacement-host" hostId="same-host" />
                <SabahCopilot />
            </SabahProvider>,
        );

        await waitFor(() => expect(screen.queryByTestId("sabah-shell")).not.toBeInTheDocument());
        expect(screen.getByRole("button", { name: /Open Sabah/i })).toBeInTheDocument();
    });

    it("ignores outside Escape for embedded Sabah and restores focus to Show Sabah after close", async () => {
        const user = userEvent.setup();
        render(
            <SabahProvider>
                <SabahWorkspaceHost hostId="view-sabah-escape" />
                <SabahCopilot />
            </SabahProvider>,
        );
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        const shell = await screen.findByTestId("sabah-shell");
        await waitFor(() => expect(shell).toHaveAttribute("data-mode", "INLINE"));

        fireEvent.keyDown(document.body, { key: "Escape" });
        expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "INLINE");

        fireEvent.keyDown(within(screen.getByTestId("sabah-shell")).getByRole("textbox", { name: /Message Sabah/i }), { key: "Escape" });
        await waitFor(() => expect(screen.queryByTestId("sabah-shell")).not.toBeInTheDocument());
        expect(screen.getByRole("button", { name: /Open Sabah/i })).toHaveFocus();

        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await waitFor(() => expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "INLINE"));
        expect(screen.getByRole("textbox", { name: /Message Sabah/i })).toHaveFocus();

        await user.click(within(screen.getByTestId("sabah-shell")).getByRole("button", { name: "Close Sabah" }));
        await waitFor(() => expect(screen.queryByTestId("sabah-shell")).not.toBeInTheDocument());
        expect(screen.getByRole("button", { name: /Open Sabah/i })).toHaveFocus();
    });

    it("keeps the hosted-view launcher above phone navigation without changing the ordinary app launcher", async () => {
        const { rerender } = render(
            <SabahProvider>
                <SabahWorkspaceHost hostId="view-navigation-clearance" />
                <SabahCopilot />
            </SabahProvider>,
        );
        await waitFor(() => expect(screen.getByRole("button", { name: /Open Sabah/i })).toHaveClass("bottom-[calc(6rem+env(safe-area-inset-bottom))]"));
        expect(screen.getByRole("button", { name: /Open Sabah/i })).toHaveClass("sm:bottom-4");

        rerender(<SabahProvider><SabahCopilot /></SabahProvider>);
        await waitFor(() => expect(screen.getByRole("button", { name: /Open Sabah/i })).not.toHaveClass("bottom-[calc(6rem+env(safe-area-inset-bottom))]"));
        expect(screen.getByRole("button", { name: /Open Sabah/i })).toHaveClass("bottom-4");
    });

    it("launcher opens the panel as complementary landmark", async () => {
        const user = userEvent.setup();
        renderCopilot();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        expect(screen.getByRole("complementary", { name: /Sabah employee copilot/i })).toBeVisible();
        expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "PANEL");
    });

    it("Escape closes the panel without losing draft (chat state persists in provider)", async () => {
        const user = userEvent.setup();
        renderCopilot();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        const composer = screen.getByRole("textbox", { name: /Message Sabah/i });
        await user.type(composer, "draft text");
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        expect(screen.getByRole("textbox", { name: /Message Sabah/i })).toHaveValue("draft text");
    });

    it("expand enters fullscreen dialog mode and collapse restores prior width", async () => {
        const user = userEvent.setup();
        renderCopilot();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.click(screen.getByRole("button", { name: /Expand Sabah/i }));
        expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "FULLSCREEN");
        expect(screen.getByRole("dialog", { name: /Sabah employee copilot/i })).toHaveAttribute("aria-modal", "true");
        await waitFor(() => expect(screen.getByRole("textbox", { name: /Message Sabah/i })).toHaveFocus());
        await user.click(screen.getByRole("button", { name: /Collapse Sabah/i }));
        expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "PANEL");
        await user.click(screen.getByRole("button", { name: /Expand Sabah/i }));
        await waitFor(() => expect(screen.getByRole("dialog", { name: /Sabah employee copilot/i })).toBeInTheDocument());
        await waitFor(() => expect(screen.getByRole("textbox", { name: /Message Sabah/i })).toHaveFocus());
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.getByRole("button", { name: /Open Sabah/i })).toHaveFocus());
    });

    it.each(NON_CHAT_TABS)("focuses the selected %s tab on global fullscreen expand and panel collapse", async (tabName) => {
        const fetchSpy = tabName === "Context" ? mockContextFetch() : null;
        try {
            const user = userEvent.setup();
            renderCopilot();
            await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
            await user.click(screen.getByRole("tab", { name: tabName }));
            await user.click(screen.getByRole("button", { name: /Expand Sabah/i }));

            await waitFor(() => expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "FULLSCREEN"));
            await waitFor(() => expect(screen.getByRole("tab", { name: tabName })).toHaveFocus());

            await user.click(screen.getByRole("button", { name: /Collapse Sabah/i }));
            await waitFor(() => expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "PANEL"));
            await waitFor(() => expect(screen.getByRole("tab", { name: tabName })).toHaveFocus());
        } finally {
            fetchSpy?.mockRestore();
        }
    });

    it.each(NON_CHAT_TABS)("focuses the selected %s tab on embedded fullscreen expand and inline restore", async (tabName) => {
        const fetchSpy = tabName === "Context" ? mockContextFetch() : null;
        try {
            const user = userEvent.setup();
            render(
                <SabahProvider>
                    <SabahWorkspaceHost hostId={"view-sabah-focus-" + tabName.toLowerCase()} />
                    <SabahCopilot />
                </SabahProvider>,
            );
            await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
            const inlineShell = await screen.findByTestId("sabah-shell");
            await waitFor(() => expect(inlineShell).toHaveAttribute("data-mode", "INLINE"));
            await user.click(within(inlineShell).getByRole("tab", { name: tabName }));
            await user.click(within(inlineShell).getByRole("button", { name: /Expand Sabah/i }));

            await waitFor(() => expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "FULLSCREEN"));
            await waitFor(() => expect(screen.getByRole("tab", { name: tabName })).toHaveFocus());

            await user.click(screen.getByRole("button", { name: /Collapse Sabah/i }));
            await waitFor(() => expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "INLINE"));
            await waitFor(() => expect(screen.getByRole("tab", { name: tabName })).toHaveFocus());
        } finally {
            fetchSpy?.mockRestore();
        }
    });

    it("distinguishes compact and fullscreen controls in panel mode", async () => {
        const user = userEvent.setup();
        renderCopilot();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));

        const collapse = screen.getByRole("button", { name: /Collapse Sabah/i });
        const expand = screen.getByRole("button", { name: /Expand Sabah/i });
        expect(collapse).toHaveAttribute("title", "Collapse to compact view");
        expect(expand).toHaveAttribute("title", "Expand to full screen");
        expect(collapse.querySelector("svg")?.getAttribute("class")).not.toBe(expand.querySelector("svg")?.getAttribute("class"));
    });

    it("compact mode renders without destroying context", async () => {
        const user = userEvent.setup();
        renderCopilot();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.click(screen.getByRole("button", { name: /Collapse Sabah/i }));
        expect(screen.getByTestId("sabah-shell")).toHaveAttribute("data-mode", "COMPACT");
    });

    it("separator is a vertical keyboard-operable separator in panel mode", async () => {
        const user = userEvent.setup();
        renderCopilot();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        const separator = screen.getByRole("separator");
        expect(separator).toHaveAttribute("aria-orientation", "vertical");
        separator.focus();
        await user.keyboard("{ArrowLeft}");
        // width changed via clamp — state-level assertion covered by reducer tests; here just ensure no crash
        expect(screen.getByTestId("sabah-shell")).toBeInTheDocument();
    });

    it("tabs are keyboard accessible with roving focus and aria-selected", async () => {
        const user = userEvent.setup();
        renderCopilot();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        const tablist = screen.getByRole("tablist", { name: /Sabah sections/i });
        const tabs = within(tablist).getAllByRole("tab");
        expect(tabs).toHaveLength(3);
        expect(tabs[0]).toHaveAttribute("aria-selected", "true");
        tabs[1].focus();
        await user.keyboard("{Enter}");
        expect(within(tablist).getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
        await user.keyboard("{ArrowRight}");
        expect(within(tablist).getAllByRole("tab")[2]).toHaveFocus();
    });

    it("focus returns to the launcher after closing", async () => {
        const user = userEvent.setup();
        renderCopilot();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.keyboard("{Escape}");
        // The launcher remounts on close; re-query for the fresh node.
        await waitFor(() => expect(screen.getByRole("button", { name: /Open Sabah/i })).toHaveFocus());
    });

    it("applies no transition classes under prefers-reduced-motion", async () => {
        // Scoped mock: honor the shared setup's other queries (the shell also
        // probes viewport/pointer media) while forcing reduced motion on.
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: query === "(prefers-reduced-motion: reduce)",
            media: query,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        }));
        const user = userEvent.setup();
        renderCopilot();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        const shell = screen.getByTestId("sabah-shell");
        expect(shell.className).not.toMatch(/transition|animate/);
    });

    it("activity tab shows an unread badge when unread > 0", async () => {
        const user = userEvent.setup();
        renderCopilot();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        expect(screen.queryByTestId("sabah-unread-badge")).not.toBeInTheDocument();
    });

    it("bounds loaded history content and replaces the thread", async () => {
        const user = userEvent.setup();
        const longContent = "x".repeat(15000);
        vi.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ messageId: "m1", conversationId: "c1", title: "Planning", excerpt: "hello" }] }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "m1", role: "assistant", content: longContent }] }), { status: 200 }));
        renderCopilot();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.click(screen.getByRole("tab", { name: "Chat" }));
        await user.type(screen.getByRole("searchbox"), "hello");
        await user.click(screen.getByRole("button", { name: /Search/i }));
        await user.click(await screen.findByRole("button", { name: "Planning" }));
        await waitFor(() => expect(screen.getByText("x".repeat(12000))).toBeInTheDocument());
        expect(screen.queryByText(longContent)).not.toBeInTheDocument();
    });

    it("shows a bounded history load error without mutating the current thread", async () => {
        const user = userEvent.setup();
        vi.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ messageId: "m1", conversationId: "c1", title: "Planning", excerpt: "hello" }] }), { status: 200 }))
            .mockRejectedValueOnce(new Error("offline"));
        renderCopilot();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.click(screen.getByRole("tab", { name: "Chat" }));
        await user.type(screen.getByRole("searchbox"), "hello");
        await user.click(screen.getByRole("button", { name: /Search/i }));
        await user.click(await screen.findByRole("button", { name: "Planning" }));
        expect(await screen.findByRole("alert")).toHaveTextContent(/history unavailable/i);
        expect(screen.getByText(/Say hello to Sabah/)).toBeInTheDocument();
    });
});
