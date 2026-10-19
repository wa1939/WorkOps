// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SabahProvider, useSabah } from "@/components/sabah/state/sabah-context";
import { OverdueReminder } from "./overdue-reminder";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/ui/badge", () => ({
    Badge: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const OVERDUE_TASK = {
    id: "task-overdue",
    title: "Review the overdue task",
    dueAt: "2020-01-01T00:00:00.000Z",
    priority: "HIGH",
    type: "TASK",
    project: { name: "Operations" },
};

function SabahShellHarness() {
    const { dispatch } = useSabah();
    return (
        <div>
            <button type="button" onClick={() => dispatch({ type: "SHELL_MODE_CHANGED", mode: "PANEL" })}>
                Open Sabah panel
            </button>
            <button type="button" onClick={() => dispatch({ type: "SHELL_MODE_CHANGED", mode: "FULLSCREEN" })}>
                Open Sabah fullscreen
            </button>
            <button type="button" onClick={() => dispatch({ type: "SHELL_MODE_CHANGED", mode: "CLOSED" })}>
                Close Sabah
            </button>
        </div>
    );
}

function renderWithSabah() {
    return render(
        <SabahProvider>
            <OverdueReminder userId="user-1" />
            <SabahShellHarness />
        </SabahProvider>,
    );
}

function overdueDialog() {
    return screen.queryByRole("dialog", { name: /overdue tasks requiring attention/i });
}

function clickShellButton(name: string): void {
    const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === name);
    if (!button) throw new Error(`Missing shell control: ${name}`);
    fireEvent.click(button);
}

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("OverdueReminder Sabah lifecycle", () => {
    it("defers a late fetch result while Sabah is open and opens it after close without writes", async () => {
        let resolveFetch: ((response: Response) => void) | undefined;
        const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
            resolveFetch = resolve;
        }));
        vi.stubGlobal("fetch", fetchMock);

        renderWithSabah();
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tasks?due=overdue&assigneeId=user-1"));

        clickShellButton("Open Sabah panel");
        await act(async () => {
            resolveFetch?.(new Response(JSON.stringify([OVERDUE_TASK]), { status: 200 }));
        });

        await waitFor(() => expect(overdueDialog()).not.toBeInTheDocument());
        expect(fetchMock).toHaveBeenCalledTimes(1);

        clickShellButton("Close Sabah");
        expect(await screen.findByRole("dialog", { name: /overdue tasks requiring attention/i })).toBeInTheDocument();
    });

    it("closes an open reminder while Sabah opens and retains it until Sabah closes", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([OVERDUE_TASK]), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        renderWithSabah();
        expect(await screen.findByRole("dialog", { name: /overdue tasks requiring attention/i })).toBeInTheDocument();

        clickShellButton("Open Sabah fullscreen");
        await waitFor(() => expect(overdueDialog()).not.toBeInTheDocument());

        clickShellButton("Close Sabah");
        expect(await screen.findByRole("dialog", { name: /overdue tasks requiring attention/i })).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not reopen after dismissal for the current day", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([OVERDUE_TASK]), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        renderWithSabah();
        expect(await screen.findByRole("dialog", { name: /overdue tasks requiring attention/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Dismiss for Today" }));
        expect(overdueDialog()).not.toBeInTheDocument();

        clickShellButton("Open Sabah panel");
        clickShellButton("Close Sabah");
        await waitFor(() => expect(overdueDialog()).not.toBeInTheDocument());
        expect(window.localStorage.getItem("overdueReminderDismissed")).toBe(new Date().toDateString());
    });

    it("keeps the original automatic behavior without a Sabah provider", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([OVERDUE_TASK]), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        render(<OverdueReminder userId="user-1" />);

        expect(await screen.findByRole("dialog", { name: /overdue tasks requiring attention/i })).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith("/api/tasks?due=overdue&assigneeId=user-1");
    });
});
