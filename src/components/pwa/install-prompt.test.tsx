// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wasDismissed } from "@/lib/pwa/install";
import { SabahProvider, useSabah } from "@/components/sabah/state/sabah-context";
import { InstallPrompt } from "./install-prompt";

type PlatformOptions = {
    standalone?: boolean;
    ios?: boolean;
    beforeInstallPromptSupported?: boolean;
};

function createLocalStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() {
            return values.size;
        },
        clear: vi.fn(() => values.clear()),
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
        removeItem: vi.fn((key: string) => values.delete(key)),
        setItem: vi.fn((key: string, value: string) => values.set(key, String(value))),
    };
}

function setBrowser(options: PlatformOptions = {}): void {
    const standalone = options.standalone ?? false;
    const ios = options.ios ?? false;
    const beforeInstallPromptSupported = options.beforeInstallPromptSupported ?? false;
    const userAgent = ios
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

    Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: userAgent });
    Object.defineProperty(window.navigator, "standalone", { configurable: true, value: standalone });
    Object.defineProperty(window.navigator, "maxTouchPoints", { configurable: true, value: ios ? 0 : 0 });
    window.matchMedia = vi.fn((query: string) => ({
        matches: standalone && query === "(display-mode: standalone)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
    }) as unknown as MediaQueryList);

    if (beforeInstallPromptSupported) {
        Object.defineProperty(window, "onbeforeinstallprompt", {
            configurable: true,
            writable: true,
            value: null,
        });
    } else {
        Reflect.deleteProperty(window, "onbeforeinstallprompt");
    }
}

function dispatchBeforeInstallPrompt(prompt: () => Promise<void>): Event & { prompt: () => Promise<void> } {
    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void> };
    Object.defineProperty(event, "prompt", { value: prompt });
    window.dispatchEvent(event);
    return event;
}

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

beforeEach(() => {
    const storage = createLocalStorage();
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
    vi.stubGlobal("localStorage", storage);
    setBrowser();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("InstallPrompt", () => {
    it("no permission prompt on mount", async () => {
        setBrowser({ beforeInstallPromptSupported: true });
        const prompt = vi.fn(() => Promise.resolve());
        const requestPermission = vi.fn();
        vi.stubGlobal("Notification", { requestPermission });

        render(<InstallPrompt />);
        let event: Event & { prompt: () => Promise<void> };
        await act(async () => {
            event = dispatchBeforeInstallPrompt(prompt);
        });

        expect(event!.defaultPrevented).toBe(true);
        expect(prompt).not.toHaveBeenCalled();
        expect(requestPermission).not.toHaveBeenCalled();
    });

    it("installed app hides install CTA", () => {
        setBrowser({ standalone: true, beforeInstallPromptSupported: true });

        render(<InstallPrompt />);

        expect(screen.queryByRole("button", { name: /install workops/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/add to home screen/i)).not.toBeInTheDocument();
    });

    it("unsupported browser gets truthful guidance", () => {
        setBrowser({ beforeInstallPromptSupported: false });

        render(<InstallPrompt />);

        expect(screen.getByText("Add to Home Screen from your browser menu to install")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /install workops/i })).not.toBeInTheDocument();
    });

    it("keeps eligible install guidance above mobile navigation until explicit dismissal", async () => {
        setBrowser({ beforeInstallPromptSupported: true });
        const prompt = vi.fn(() => Promise.resolve());

        render(<InstallPrompt />);
        await act(async () => {
            dispatchBeforeInstallPrompt(prompt);
        });

        const aside = await screen.findByRole("complementary", { name: "Install WorkOps" });
        expect(aside).toHaveClass("bottom-[calc(5rem+env(safe-area-inset-bottom))]");
        expect(aside).toHaveClass("md:bottom-4");
        expect(screen.getByRole("button", { name: /install workops/i })).toBeVisible();
        expect(wasDismissed()).toBe(false);

        fireEvent.click(screen.getByRole("button", { name: /dismiss install guidance/i }));
        expect(wasDismissed()).toBe(true);
        expect(aside).not.toBeVisible();
    });

    it("dismissal does not repeat each navigation", () => {
        setBrowser({ beforeInstallPromptSupported: false });
        const { unmount } = render(<InstallPrompt />);

        fireEvent.click(screen.getByRole("button", { name: /dismiss install guidance/i }));
        expect(wasDismissed()).toBe(true);
        expect(screen.queryByText("Add to Home Screen from your browser menu to install")).not.toBeInTheDocument();

        unmount();
        render(<InstallPrompt />);

        expect(screen.queryByText("Add to Home Screen from your browser menu to install")).not.toBeInTheDocument();
    });

    it.each(["PANEL", "FULLSCREEN"] as const)("hides automatic guidance while Sabah is %s and restores it after close", async (mode) => {
        setBrowser({ beforeInstallPromptSupported: true });
        const prompt = vi.fn(() => Promise.resolve());

        render(
            <SabahProvider>
                <InstallPrompt />
                <SabahShellHarness />
            </SabahProvider>,
        );

        await act(async () => {
            dispatchBeforeInstallPrompt(prompt);
        });
        expect(await screen.findByRole("button", { name: /install workops/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: `Open Sabah ${mode === "PANEL" ? "panel" : "fullscreen"}` }));
        expect(screen.queryByRole("button", { name: /install workops/i })).not.toBeInTheDocument();
        expect(screen.queryByRole("complementary", { name: "Install WorkOps" })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Close Sabah" }));
        expect(await screen.findByRole("complementary", { name: "Install WorkOps" })).toBeInTheDocument();
    });
});
