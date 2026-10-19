// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../sabah/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationPreferences } from "./preferences";

const taskPreference = {
    id: "preference-task",
    userId: "user-1",
    category: "task",
    emailEnabled: false,
    inAppEnabled: true,
    pushEnabled: true,
    quietEnabled: true,
    quietStartMinute: 1320,
    quietEndMinute: 420,
    timezone: "Asia/Riyadh",
};

const accountSecurityPreference = {
    ...taskPreference,
    id: "preference-account-security",
    category: "account_security",
    emailEnabled: true,
};

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("NotificationPreferences", () => {
    it("preference survives reload", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ preferences: [taskPreference] }));
        vi.stubGlobal("fetch", fetchMock);

        render(
            <NotificationPreferences
                categories={[{ category: "task", label: "Task reminders" }]}
            />,
        );

        expect(await screen.findByRole("switch", { name: "Task reminders email" })).toHaveAttribute("aria-checked", "false");
        expect(screen.getByRole("switch", { name: "Task reminders in-app" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("switch", { name: "Task reminders push" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByText("Asia/Riyadh")).toBeInTheDocument();
        expect(screen.getByLabelText("Task reminders quiet mode")).toHaveAttribute("aria-checked", "true");
    });

    it("save failure restores previous value", async () => {
        let resolvePut: ((response: Response) => void) | undefined;
        const putResponse = new Promise<Response>((resolve) => { resolvePut = resolve; });
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ preferences: [{ ...taskPreference, emailEnabled: true }] }))
            .mockReturnValueOnce(putResponse);
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(<NotificationPreferences categories={[{ category: "task", label: "Task reminders" }]} />);
        const emailSwitch = await screen.findByRole("switch", { name: "Task reminders email" });
        expect(emailSwitch).toHaveAttribute("aria-checked", "true");

        await user.click(emailSwitch);
        expect(emailSwitch).toHaveAttribute("aria-checked", "false");
        resolvePut?.(jsonResponse({ error: "Unable to save notification preference" }, 500));
        await waitFor(() => expect(emailSwitch).toHaveAttribute("aria-checked", "true"));
        expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save notification preference");
    });

    it("account security email cannot be disabled", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ preferences: [accountSecurityPreference] }))
            .mockResolvedValueOnce(jsonResponse({ error: "Account security email cannot be disabled" }, 400));
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(
            <NotificationPreferences
                categories={[{ category: "account_security", label: "Account security" }]}
            />,
        );
        const emailSwitch = await screen.findByRole("switch", { name: "Account security email" });

        await user.click(emailSwitch);
        await waitFor(() => expect(emailSwitch).toHaveAttribute("aria-checked", "true"));
        expect(await screen.findByRole("alert")).toHaveTextContent("Account security email cannot be disabled");
    });
});
