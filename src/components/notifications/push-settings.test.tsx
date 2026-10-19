// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PushSettings } from "./push-settings";

const BLOCKED_MESSAGE = "Push notifications are blocked. Reset notification permission in your browser settings to enable push notifications.";
const OWNERSHIP_CONFLICT_MESSAGE = "endpoint already registered on this device for another account";

type PermissionStatusMock = {
    state: PermissionState;
    addEventListener: (type: string, listener: EventListener) => void;
    removeEventListener: (type: string, listener: EventListener) => void;
};

type PushSubscriptionMock = {
    endpoint: string;
    toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
    unsubscribe: ReturnType<typeof vi.fn>;
};

type PushManagerMock = {
    subscribe: ReturnType<typeof vi.fn>;
    getSubscription: ReturnType<typeof vi.fn>;
};

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

let permission: NotificationPermission;
let requestPermission: ReturnType<typeof vi.fn>;
let pushManager: PushManagerMock;
let serviceWorker: { ready: Promise<{ pushManager: PushManagerMock }> };
let permissionStatus: PermissionStatusMock;
let permissionListeners: Set<EventListener>;
let fetchMock: FetchMock;
let previousServiceWorker: PropertyDescriptor | undefined;
let previousPermissions: PropertyDescriptor | undefined;

function response(status: number, body: Record<string, unknown> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function subscription(endpoint = "https://push.example/subscription-1"): PushSubscriptionMock {
    return {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: "public-key", auth: "auth-key" } }),
        unsubscribe: vi.fn(async () => true),
    };
}

function changePermission(next: NotificationPermission): void {
    permission = next;
    permissionStatus.state = next === "default" ? "prompt" : next;
    permissionListeners.forEach((listener) => listener(new Event("change")));
}

beforeEach(() => {
    permission = "default";
    permissionListeners = new Set();
    permissionStatus = {
        state: "prompt",
        addEventListener: (_type, listener) => permissionListeners.add(listener),
        removeEventListener: (_type, listener) => permissionListeners.delete(listener),
    };
    requestPermission = vi.fn(async () => {
        changePermission("granted");
        return "granted" as NotificationPermission;
    });
    pushManager = {
        subscribe: vi.fn(async () => subscription()),
        getSubscription: vi.fn(async () => null),
    };
    serviceWorker = { ready: Promise.resolve({ pushManager }) };
    fetchMock = vi.fn<typeof fetch>(async () => response(201, { ok: true }));

    const notification = { requestPermission };
    Object.defineProperty(notification, "permission", {
        configurable: true,
        get: () => permission,
    });
    vi.stubGlobal("Notification", notification);
    vi.stubGlobal("PushManager", function MockPushManager() {});
    vi.stubGlobal("fetch", fetchMock);

    previousServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    previousPermissions = Object.getOwnPropertyDescriptor(navigator, "permissions");
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: { query: vi.fn(async () => permissionStatus) },
    });
});

afterEach(() => {
    cleanup();
    if (previousServiceWorker) Object.defineProperty(navigator, "serviceWorker", previousServiceWorker);
    else Reflect.deleteProperty(navigator, "serviceWorker");
    if (previousPermissions) Object.defineProperty(navigator, "permissions", previousPermissions);
    else Reflect.deleteProperty(navigator, "permissions");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("PushSettings", () => {
    it("denied permission never loops", async () => {
        const user = userEvent.setup();
        requestPermission.mockImplementationOnce(async () => {
            changePermission("denied");
            return "denied" as NotificationPermission;
        });

        render(<PushSettings />);
        await user.click(screen.getByRole("button", { name: "Enable push" }));

        expect(await screen.findByText(BLOCKED_MESSAGE)).toBeVisible();
        expect(screen.getAllByText(BLOCKED_MESSAGE)).toHaveLength(1);
        expect(screen.queryByRole("button", { name: "Enable push" })).not.toBeInTheDocument();
        expect(requestPermission).toHaveBeenCalledTimes(1);
        expect(pushManager.subscribe).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("logout stops old recipients push", async () => {
        const user = userEvent.setup();
        const events: string[] = [];
        const currentSubscription = subscription();
        currentSubscription.unsubscribe.mockImplementation(async () => {
            events.push("unsubscribe");
            return true;
        });
        pushManager.subscribe.mockResolvedValueOnce(currentSubscription);
        fetchMock.mockImplementation(async (_input, init) => {
            events.push(init?.method ?? "GET");
            return response(201, { ok: true });
        });

        render(<PushSettings />);
        await user.click(screen.getByRole("button", { name: "Enable push" }));
        expect(await screen.findByRole("button", { name: "Disable push" })).toBeVisible();

        await user.click(screen.getByRole("button", { name: "Disable push" }));
        await waitFor(() => expect(events).toEqual(["POST", "DELETE", "unsubscribe"]));
        expect(screen.queryByRole("button", { name: "Disable push" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Enable push" })).toBeVisible();
    });

    it("new account cannot inherit endpoint", async () => {
        const user = userEvent.setup();
        permission = "granted";
        permissionStatus.state = "granted";
        pushManager.subscribe.mockResolvedValueOnce(subscription("https://push.example/old-account"));
        fetchMock.mockResolvedValueOnce(response(409, { error: OWNERSHIP_CONFLICT_MESSAGE }));

        render(<PushSettings />);
        await user.click(screen.getByRole("button", { name: "Enable push" }));

        expect(await screen.findByText(OWNERSHIP_CONFLICT_MESSAGE)).toBeVisible();
        expect(screen.getByTestId("browser-permission-state")).toHaveTextContent("Granted");
        expect(screen.getByTestId("server-registration-state")).toHaveTextContent(/not registered|failed/i);
        expect(screen.queryByRole("button", { name: "Disable push" })).not.toBeInTheDocument();
    });

    it("permission revoked updates UI", async () => {
        const user = userEvent.setup();
        render(<PushSettings />);
        await user.click(screen.getByRole("button", { name: "Enable push" }));
        expect(await screen.findByRole("button", { name: "Disable push" })).toBeVisible();

        changePermission("denied");

        expect(await screen.findByText(BLOCKED_MESSAGE)).toBeVisible();
        expect(screen.getByTestId("browser-permission-state")).toHaveTextContent("Blocked");
        expect(screen.queryByRole("button", { name: "Disable push" })).not.toBeInTheDocument();
        expect(screen.queryByText(/Push notifications are enabled/i)).not.toBeInTheDocument();
    });

    it("enable flow shows two independent states", async () => {
        const user = userEvent.setup();
        const currentSubscription = subscription();
        pushManager.subscribe.mockResolvedValueOnce(currentSubscription);
        let resolveRegistration!: (value: Response) => void;
        const registrationPending = new Promise<Response>((resolve) => {
            resolveRegistration = resolve;
        });
        fetchMock.mockImplementationOnce(async () => registrationPending);

        const first = render(<PushSettings />);
        await user.click(screen.getByRole("button", { name: "Enable push" }));

        expect(await screen.findByTestId("browser-permission-state")).toHaveTextContent("Granted");
        expect(await screen.findByTestId("server-registration-state")).toHaveTextContent(/pending|not registered/i);
        expect(screen.queryByRole("button", { name: "Disable push" })).not.toBeInTheDocument();

        resolveRegistration(response(201, { ok: true }));
        expect(await screen.findByTestId("server-registration-state")).toHaveTextContent("Registered");
        expect(screen.getByRole("button", { name: "Disable push" })).toBeVisible();
        expect(screen.getByTestId("browser-permission-state")).toHaveTextContent("Granted");

        first.unmount();
        permission = "default";
        permissionStatus.state = "prompt";
        pushManager.subscribe.mockResolvedValueOnce(subscription("https://push.example/failed-registration"));
        fetchMock.mockImplementationOnce(async () => response(500, { error: "temporary registration failure" }));
        render(<PushSettings />);

        await user.click(screen.getByRole("button", { name: "Enable push" }));
        expect(await screen.findByTestId("browser-permission-state")).toHaveTextContent("Granted");
        expect(await screen.findByText(/permission granted but registration failed/i)).toBeVisible();
        expect(screen.getByTestId("server-registration-state")).toHaveTextContent(/failed|not registered/i);
        expect(screen.getByRole("button", { name: "Retry registration" })).toBeVisible();
        expect(screen.queryByRole("button", { name: "Disable push" })).not.toBeInTheDocument();
    });
});
