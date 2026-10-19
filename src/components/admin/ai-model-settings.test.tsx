// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../sabah/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiModelSettings } from "./ai-model-settings";

beforeEach(() => {
    vi.clearAllMocks();
});

const providers = [
    { id: "cred-1", providerKey: "zai", keyVersion: 2, isEnabled: true, maskedHint: "zai•••••key1", source: "db" as const, mutable: true as const, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" },
    { id: "cred-2", providerKey: "openai", keyVersion: 1, isEnabled: true, maskedHint: "ska••••abcd", source: "db" as const, mutable: true as const, createdAt: "2026-08-05T00:00:00.000Z", updatedAt: "2026-08-05T00:00:00.000Z" },
];

const assignments = [
    { role: "CHAT", providerKey: "zai", model: "glm-4.7" },
    { role: "PLANNER", providerKey: "zai", model: "glm-4.7" },
];

const api = {
    listProviders: vi.fn().mockResolvedValue(providers),
    listAssignments: vi.fn().mockResolvedValue(assignments),
    saveCredential: vi.fn().mockResolvedValue({ ok: true }),
    testCredential: vi.fn().mockResolvedValue({ ok: true, latencyMs: 240 }),
    assignRole: vi.fn().mockResolvedValue({ ok: true }),
    rollback: vi.fn().mockResolvedValue({ ok: true }),
};

describe("AiModelSettings", () => {
    it("renders provider rows with masked hints only (never full keys)", async () => {
        render(<AiModelSettings api={api} />);
        expect(await screen.findByText("zai", { selector: "span" })).toBeVisible();
        expect(screen.getByText(/zai•••••key1/)).toBeVisible();
        expect(screen.queryByText(/sk-[a-zA-Z0-9]{20,}/)).not.toBeInTheDocument();
    });

    it("credential input is password-typed with autocomplete off and starts empty", async () => {
        render(<AiModelSettings api={api} />);
        const input = await screen.findByLabelText(/API key for zai/i);
        expect(input).toHaveAttribute("type", "password");
        expect(input).toHaveAttribute("autocomplete", "new-password");
        expect(input).toHaveValue("");
    });

    it("saving requires an explicit click and sends only the new key", async () => {
        const user = userEvent.setup();
        render(<AiModelSettings api={api} />);
        const input = await screen.findByLabelText(/API key for zai/i);
        await user.type(input, "brand-new-key");
        await user.click(screen.getByRole("button", { name: /Save zai credential/i }));
        expect(api.saveCredential).toHaveBeenCalledWith("zai", "brand-new-key");
    });

    it("empty credential field preserves the current value (no clear)", async () => {
        const user = userEvent.setup();
        render(<AiModelSettings api={api} />);
        await screen.findByText("zai", { selector: "span" });
        await user.click(screen.getByRole("button", { name: /Save openai credential/i }));
        expect(api.saveCredential).not.toHaveBeenCalled();
    });

    it("connection test reports status", async () => {
        const user = userEvent.setup();
        render(<AiModelSettings api={api} />);
        await screen.findByText("zai", { selector: "span" });
        await user.click(screen.getByRole("button", { name: /Test zai connection/i }));
        expect(await screen.findByText(/connected/i)).toBeVisible();
        expect(api.testCredential).toHaveBeenCalledWith("zai");
    });

    it("shows only model roles with wired runtime adapters", async () => {
        render(<AiModelSettings api={api} />);
        const chatSelect = await screen.findByLabelText(/Model for CHAT/i);
        expect(chatSelect).toHaveValue("zai:glm-4.7");
        for (const role of ["CHAT", "COMPRESSION"]) {
            expect(screen.getByLabelText(new RegExp(`Model for ${role}`, "i"))).toBeInTheDocument();
        }
        for (const role of ["PLANNER", "CRITIC", "VISION", "OCR", "ASR", "EMBEDDING"]) {
            expect(screen.queryByLabelText(new RegExp(`Model for ${role}`, "i"))).not.toBeInTheDocument();
        }
    });

    it("does not offer providers without a CHAT runtime adapter for the CHAT role", async () => {
        render(<AiModelSettings api={api} />);
        const chatSelect = await screen.findByLabelText(/Model for CHAT/i) as HTMLSelectElement;
        const compressionSelect = screen.getByLabelText(/Model for COMPRESSION/i) as HTMLSelectElement;
        expect(Array.from(chatSelect.options, (option) => option.value)).not.toContain("openai:gpt-4o-mini");
        expect(Array.from(compressionSelect.options, (option) => option.value)).not.toContain("openai:gpt-4o-mini");
        expect(Array.from(compressionSelect.options, (option) => option.value)).not.toContain("zai:glm-5.3");
    });

    it("rollback requires confirmation", async () => {
        const user = userEvent.setup();
        render(<AiModelSettings api={api} />);
        await screen.findByText("zai", { selector: "span" });
        await user.click(screen.getByRole("button", { name: /Rollback zai to last-known-good/i }));
        expect(api.rollback).not.toHaveBeenCalled();
        await user.click(screen.getByRole("button", { name: /Confirm rollback/i }));
        expect(api.rollback).toHaveBeenCalledWith("zai");
    });

    it("renders nothing when the viewer is not an admin", () => {
        const { container } = render(<AiModelSettings api={api} isAdmin={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("renders environment providers read-only", async () => {
        api.listProviders.mockResolvedValueOnce([
            { id: "env:nuha", providerKey: "nuha", keyVersion: 0, isEnabled: true, maskedHint: "configured via environment", source: "env", mutable: false, createdAt: "", updatedAt: "" },
        ]);
        render(<AiModelSettings api={api} />);
        await screen.findByText("nuha", { selector: "span" });
        expect(screen.getByText(/environment-backed/i)).toBeVisible();
        expect(screen.getByText(/read-only/i)).toBeVisible();
        expect(screen.queryByLabelText(/API key for nuha/i)).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Test nuha/i })).not.toBeInTheDocument();
    });

    it("keeps assignments visible and offers a provider-only retry when provider loading fails", async () => {
        api.listProviders.mockReset()
            .mockRejectedValueOnce(new Error("provider metadata unavailable"))
            .mockResolvedValue(providers);
        api.listAssignments.mockReset().mockResolvedValue(assignments);
        render(<AiModelSettings api={api} />);

        expect(await screen.findByText(/provider metadata unavailable/i)).toBeVisible();
        expect(screen.getByLabelText(/Model for CHAT/i)).toHaveValue("zai:glm-4.7");
        await userEvent.click(screen.getByRole("button", { name: /Retry providers/i }));
        expect(await screen.findByText("zai", { selector: "span" })).toBeVisible();
        expect(api.listProviders).toHaveBeenCalledTimes(2);
    });

    it("keeps providers visible and offers an assignment-only retry when assignment loading fails", async () => {
        api.listProviders.mockReset().mockResolvedValue(providers);
        api.listAssignments.mockReset()
            .mockRejectedValueOnce(new Error("assignment metadata unavailable"))
            .mockResolvedValue(assignments);
        render(<AiModelSettings api={api} />);

        expect(await screen.findByText(/assignment metadata unavailable/i)).toBeVisible();
        expect(await screen.findByText("zai", { selector: "span" })).toBeVisible();
        await userEvent.click(screen.getByRole("button", { name: /Retry assignments/i }));
        expect(await screen.findByLabelText(/Model for CHAT/i)).toHaveValue("zai:glm-4.7");
        expect(api.listAssignments).toHaveBeenCalledTimes(2);
    });

    it("shows a mutation error instead of leaving an unhandled rejection", async () => {
        api.listProviders.mockReset().mockResolvedValue(providers);
        api.listAssignments.mockReset().mockResolvedValue(assignments);
        api.saveCredential.mockReset().mockRejectedValueOnce(new Error("credential writes are unavailable"));
        render(<AiModelSettings api={api} />);
        const user = userEvent.setup();
        const input = await screen.findByLabelText(/API key for zai/i);
        await user.type(input, "new-key");
        await user.click(screen.getByRole("button", { name: /Save zai credential/i }));
        expect(await screen.findByText(/credential writes are unavailable/i)).toBeVisible();
    });

    it("renders an explicit fallback list and keeps legacy mode distinct from disabled", async () => {
        api.listProviders.mockReset().mockResolvedValue([
            ...providers,
            { id: "cred-3", providerKey: "nuha", keyVersion: 1, isEnabled: true, maskedHint: "nuh•••••••key", source: "db" as const, mutable: true as const, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" },
        ]);
        api.listAssignments.mockReset().mockResolvedValue([
            { role: "CHAT", providerKey: "zai", model: "glm-5", fallbacks: [{ providerKey: "nuha", model: "Nuha-2.1" }] },
        ]);
        render(<AiModelSettings api={api} />);

        expect(await screen.findByLabelText(/Fallback mode for CHAT/i)).toHaveValue("explicit");
        expect(screen.getByLabelText(/Fallback 1 model for CHAT/i)).toHaveValue("nuha:Nuha-2.1");
        expect(screen.getByText(/explicit targets only/i)).toBeVisible();
    });

    it("persists automatic fallback mode with an explicit null sentinel", async () => {
        api.listProviders.mockReset().mockResolvedValue(providers);
        api.listAssignments.mockReset().mockResolvedValue(assignments);
        api.assignRole.mockReset().mockResolvedValue({ ok: true });
        render(<AiModelSettings api={api} />);
        const user = userEvent.setup();

        await screen.findByLabelText(/Model for CHAT/i);
        await user.click(screen.getByRole("button", { name: /Save CHAT assignment/i }));

        expect(api.assignRole).toHaveBeenCalledWith("CHAT", "zai", "glm-4.7", null);
    });

    it("persists an explicit disabled fallback list and primary unassignment", async () => {
        api.listProviders.mockReset().mockResolvedValue(providers);
        api.listAssignments.mockReset().mockResolvedValue(assignments);
        api.assignRole.mockReset().mockResolvedValue({ ok: true });
        render(<AiModelSettings api={api} />);
        const user = userEvent.setup();
        const chatSelect = await screen.findByLabelText(/Model for CHAT/i);
        await user.selectOptions(screen.getByLabelText(/Fallback mode for CHAT/i), "disabled");
        await user.click(screen.getByRole("button", { name: /Save CHAT assignment/i }));
        expect(api.assignRole).toHaveBeenCalledWith("CHAT", "zai", "glm-4.7", []);

        await user.selectOptions(chatSelect, "");
        await user.click(screen.getByRole("button", { name: /Save CHAT assignment/i }));
        expect(api.assignRole).toHaveBeenLastCalledWith("CHAT", null, null, undefined);
    });

    it("renders an unconfigured provider placeholder as creatable but not testable", async () => {
        api.listProviders.mockReset().mockResolvedValueOnce([
            { id: "new:nuha", providerKey: "nuha", keyVersion: 0, isEnabled: false, maskedHint: "not configured", source: "placeholder", mutable: true, createdAt: "", updatedAt: "" },
        ]);
        api.listAssignments.mockReset().mockResolvedValue([]);
        render(<AiModelSettings api={api} />);
        expect(await screen.findByLabelText(/API key for nuha/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Save nuha credential/i })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Test nuha connection/i })).not.toBeInTheDocument();
    });
});
