// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SabahModelSettingsSection } from "./sabah-model-settings-section";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

it("creates the first stored credential for an unconfigured provider placeholder", async () => {
    const placeholder = { id: "new:nuha", providerKey: "nuha", keyVersion: 0, isEnabled: false, maskedHint: "not configured", source: "placeholder", mutable: true, createdAt: "", updatedAt: "" };
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
        if (input.endsWith("/model-assignments")) return new Response(JSON.stringify({ assignments: [] }), { status: 200 });
        if (input.endsWith("/providers") && init?.method === "POST") return new Response(JSON.stringify({ ok: true }), { status: 201 });
        return new Response(JSON.stringify({ providers: [placeholder] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SabahModelSettingsSection />);
    await user.type(await screen.findByLabelText(/API key for nuha/i), "first-stored-key");
    await user.click(screen.getByRole("button", { name: /Save nuha credential/i }));
    expect(fetchMock).toHaveBeenCalledWith("/api/ai/admin/providers", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ providerKey: "nuha", credential: "first-stored-key" }),
    }));
});

        it("surfaces the server's actionable credential-storage error", async () => {
            const placeholder = { id: "new:nuha", providerKey: "nuha", keyVersion: 0, isEnabled: false, maskedHint: "not configured", source: "placeholder", mutable: true, createdAt: "", updatedAt: "" };
            const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
                if (input.endsWith("/model-assignments")) return new Response(JSON.stringify({ assignments: [] }), { status: 200 });
                if (input.endsWith("/providers") && init?.method === "POST") {
                    return new Response(JSON.stringify({ error: "Credential writes are unavailable; configure SABAH_CREDENTIAL_KEY" }), { status: 503 });
                }
                return new Response(JSON.stringify({ providers: [placeholder] }), { status: 200 });
            });
            vi.stubGlobal("fetch", fetchMock);
            const user = userEvent.setup();
            render(<SabahModelSettingsSection />);
            await user.type(await screen.findByLabelText(/API key for nuha/i), "first-stored-key");
            await user.click(screen.getByRole("button", { name: /Save nuha credential/i }));
            expect(await screen.findByText(/configure SABAH_CREDENTIAL_KEY/i)).toBeTruthy();
        });


it("posts explicit fallback targets and the automatic null sentinel through the real adapter", async () => {
    const providers = [
        { id: "cred:zai", providerKey: "zai", keyVersion: 1, isEnabled: true, maskedHint: "zai••••key", source: "db", mutable: true, createdAt: "", updatedAt: "" },
        { id: "cred:nuha", providerKey: "nuha", keyVersion: 1, isEnabled: true, maskedHint: "nuh••••key", source: "db", mutable: true, createdAt: "", updatedAt: "" },
    ];
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
        if (input.endsWith("/providers")) return new Response(JSON.stringify({ providers }), { status: 200 });
        if (input.endsWith("/model-assignments") && init?.method === "PUT") return new Response(JSON.stringify({ ok: true }), { status: 200 });
        if (input.endsWith("/model-assignments")) {
            return new Response(JSON.stringify({ assignments: [{ role: "CHAT", providerKey: "zai", model: "glm-5" }] }), { status: 200 });
        }
        throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SabahModelSettingsSection />);

    await screen.findByLabelText(/Model for CHAT/i);
    await user.selectOptions(screen.getByLabelText(/Fallback mode for CHAT/i), "explicit");
    await user.selectOptions(screen.getByLabelText(/Fallback 1 model for CHAT/i), "nuha:Nuha-2.1");
    await user.click(screen.getByRole("button", { name: /Save CHAT assignment/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/ai/admin/model-assignments", expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            fallbacks: [{ providerKey: "nuha", modelName: "Nuha-2.1" }],
        }),
    })));

    await user.click(screen.getByRole("button", { name: /Save CHAT assignment/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/ai/admin/model-assignments", expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            fallbacks: null,
        }),
    })));
});