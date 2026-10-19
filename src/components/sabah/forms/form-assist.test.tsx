// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import "../test/setup";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SabahFormProvider, useSabahFormField } from "./form-context";
import { FormAssistMenu } from "./form-assist-menu";
import { FieldAssist } from "./field-assist";
import { SabahProvider, useSabah } from "../state/sabah-context";
import type { FeedbackInput } from "@/lib/sabah/feedback/contracts";
import { applyFieldSuggestion, serializeSabahFormSnapshot, type SabahFieldDescriptor } from "./contracts";

function createField(name: string, value: string, extra: Partial<SabahFieldDescriptor<string>> = {}): SabahFieldDescriptor<string> {
    const descriptor: SabahFieldDescriptor<string> = {
        name,
        label: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        empty: value === "",
        protected: false,
        risk: "DRAFT",
        actions: ["SUGGEST"],
        validate: async (v) => ({ ok: true, value: v as string }),
        setValue: (v: string) => {
            descriptor.value = v;
            descriptor.empty = v === "";
        },
        commit: async (v: string) => ({ value: v }),
        ...extra,
    };
    return descriptor;
}

function FormFixture({ fields, suggestions, feedbackRecorder }: { fields: SabahFieldDescriptor<string>[]; suggestions?: Record<string, { proposed: string; base: string; sourceRefs?: string[]; confidence?: number; proposedDiffHash?: string }>; feedbackRecorder?: (input: FeedbackInput) => Promise<void> }) {
    return (
        <SabahFormProvider formId="project-new" entityType="project" entityId={null} recordVersion={null} fields={fields} suggestions={suggestions ?? {}} feedbackRecorder={feedbackRecorder}>
            {fields.map((field) => (
                <FieldRow key={field.name} name={field.name} />
            ))}
            <FormAssistMenu />
        </SabahFormProvider>
    );
}

function FieldRow({ name }: { name: string }) {
    const field = useSabahFormField(name);
    const [value, setValue] = useState<string>(String(field?.value ?? ""));
    if (!field) {
        return <input aria-label={name} value={value} onChange={(e) => setValue(e.target.value)} readOnly />;
    }
    return (
        <input
            aria-label={field.label}
            value={value}
            onChange={(e) => {
                setValue(e.target.value);
                field.updateValue(e.target.value);
            }}
        />
    );
}

function FormContextProbe() {
    const { state } = useSabah();
    const title = String(state.formContext?.fields.title?.value ?? "");
    return <output data-testid="registered-form-context">{state.formContext?.formId ?? "none"}:{title}</output>;
}

describe("applyFieldSuggestion (pure)", () => {
    it("detects a stale field instead of applying over the user", () => {
        expect(applyFieldSuggestion({ base: "A", current: "B", proposed: "C" }).status).toBe("CONFLICT");
    });

    it("applies cleanly when current matches base", () => {
        const result = applyFieldSuggestion({ base: "A", current: "A", proposed: "C" });
        expect(result.status).toBe("APPLIED");
        expect(result.value).toBe("C");
    });

    it("fills an empty field", () => {
        const result = applyFieldSuggestion({ base: "", current: "", proposed: "New" });
        expect(result.status).toBe("APPLIED");
        expect(result.value).toBe("New");
    });
});

describe("FormAssistMenu — fill empty fields only", () => {
    it("fill empty fields changes no non-empty field", async () => {
        const user = userEvent.setup();
        const nameField = createField("name", "My project");
        const objectiveField = createField("objective", "");
        const fields = [nameField, objectiveField];
        const suggestions = {
            name: { proposed: "Sabah name", base: "My project" },
            objective: { proposed: "Proposed objective", base: "" },
        };
        render(<FormFixture fields={fields} suggestions={suggestions} />);
        await user.click(screen.getByRole("button", { name: /Fill empty fields only/i }));
        await user.click(screen.getByRole("button", { name: /Apply 1 field/i }));
        expect(nameField.value).toBe("My project");
        expect(objectiveField.value).toBe("Proposed objective");
        expect(screen.getByText("1 filled · 1 protected · 0 overwritten")).toBeVisible();
    });

    it("never applies to protected/read-only fields", async () => {
        const user = userEvent.setup();
        const codeField = createField("code", "", { protected: true, setValue: vi.fn() });
        render(<FormFixture fields={[codeField]} suggestions={{ code: { proposed: "X-1", base: "" } }} />);
        await user.click(screen.getByRole("button", { name: /Fill empty fields only/i }));
        // nothing staged (protected), so nothing can be applied
        expect(codeField.setValue).not.toHaveBeenCalled();
        expect(screen.getByText("1 protected · 0 overwritten")).toBeVisible();
    });

    it("reports conflicts instead of overwriting drifted values", async () => {
        const user = userEvent.setup();
        const nameField = createField("name", "User edited");
        render(<FormFixture fields={[nameField]} suggestions={{ name: { proposed: "Sabah name", base: "Original" } }} />);
        await user.click(screen.getByRole("button", { name: /Suggest with diff/i }));
        expect(await screen.findByText(/conflict/i)).toBeInTheDocument();
        expect(nameField.value).toBe("User edited");
    });
});

describe("global Sabah page context", () => {
    it("serializes bounded field context without credential-like fields", () => {
        const context = serializeSabahFormSnapshot({
            formId: "task-edit",
            entityType: "task",
            entityId: "t1",
            recordVersion: "v1",
            fields: { title: { value: "Prepare deck" }, password: { value: "secret" } },
        });
        expect(context.fields).toEqual({ title: { value: "Prepare deck" } });
    });

    it("registers the typed form snapshot with the copilot provider", async () => {
        const field = createField("title", "Prepare BSC deck");
        render(
            <SabahProvider>
                <FormContextProbe />
                <FormFixture fields={[field]} />
            </SabahProvider>,
        );
        await waitFor(() => expect(screen.getByTestId("registered-form-context")).toHaveTextContent("project-new"));
    });

    it("refreshes the registered snapshot when a field changes", async () => {
        const user = userEvent.setup();
        const field = createField("title", "Prepare BSC deck");
        render(
            <SabahProvider>
                <FormContextProbe />
                <FormFixture fields={[field]} />
            </SabahProvider>,
        );
        const input = screen.getByRole("textbox", { name: "Title" });
        await user.clear(input);
        await user.type(input, "Updated title");
        await waitFor(() => expect(screen.getByTestId("registered-form-context")).toHaveTextContent("project-new:Updated title"));
    });
});

describe("field-level assistance", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("Keep mine / Use Sabah resolve a single-field suggestion", async () => {
        const user = userEvent.setup();
        const objectiveField = createField("objective", "");
        render(<FormFixture fields={[objectiveField]} suggestions={{ objective: { proposed: "Proposed objective", base: "" } }} />);
        await user.click(screen.getByRole("button", { name: /Suggest with diff|Review with Sabah/i }));
        await user.click(screen.getByRole("button", { name: /Use Sabah/i }));
        expect(objectiveField.value).toBe("Proposed objective");
    });

    it("validation failure blocks apply and shows the message", async () => {
        const user = userEvent.setup();
        const nameField = createField("name", "", {
            validate: async (v) => (String(v).length >= 3 ? { ok: true, value: v as string } : { ok: false, message: "At least 3 characters" }),
        });
        render(<FormFixture fields={[nameField]} suggestions={{ name: { proposed: "Ab", base: "" } }} />);
        await user.click(screen.getByRole("button", { name: /Suggest with diff|Review with Sabah/i }));
        await user.click(screen.getByRole("button", { name: /Use Sabah/i }));
        expect(await screen.findByText(/At least 3 characters/i)).toBeInTheDocument();
        expect(nameField.value).toBe("");
    });

    it("MERGE records EDITED only after commit with distinct hashes", async () => {
        const user = userEvent.setup();
        const recorder = vi.fn(async () => undefined);
        const field = createField("name", "Current", { merge: (current, proposed) => `${current} + ${proposed}`, hash: async (value) => value === "Proposed" ? "a".repeat(64) : "b".repeat(64) });
        render(<FormFixture fields={[field]} feedbackRecorder={recorder} suggestions={{ name: { proposed: "Proposed", base: "Current", proposedDiffHash: "a".repeat(64) } }} />);
        await user.click(screen.getByRole("button", { name: /Suggest with diff/i }));
        await user.click(screen.getByRole("button", { name: "Merge" }));
        expect(field.value).toBe("Current + Proposed");
        expect(recorder).toHaveBeenCalledWith(expect.objectContaining({ outcome: "EDITED", proposedDiffHash: "a".repeat(64), finalDiffHash: "b".repeat(64) }));
    });

    it("generates a suggestion via the FieldAssist button and applies it through the diff flow", async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ proposed: "Sabah drafted description", base: "" }), { status: 200, headers: { "content-type": "application/json" } })
        );
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();
        const titleField = createField("title", "Prepare BSC deck");
        const descriptionField = createField("description", "");
        const recorder = vi.fn(async () => undefined);
        render(
            <SabahFormProvider formId="task-new" entityType="task" entityId={null} recordVersion={null} fields={[titleField, descriptionField]} suggestions={{}} feedbackRecorder={recorder}>
                <FieldRow name="description" />
                <FieldAssist fieldName="description" />
                <FormAssistMenu />
            </SabahFormProvider>
        );
        const assist = screen.getByRole("button", { name: "Sabah assistance for Description" });
        expect(assist).toBeVisible();
        await user.click(assist);

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/ai/field-assist");
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({ entityType: "task", fieldName: "description", fieldLabel: "Description", currentValue: "" });
        expect(body.context.title).toBe("Prepare BSC deck");

        // Suggestion staged + review triggered: diff and explicit apply appear
        expect(await screen.findByTestId("sabah-field-diff-description")).toBeInTheDocument();
        expect(screen.getByText("Sabah drafted description")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Use Sabah/i }));
        expect(descriptionField.value).toBe("Sabah drafted description");
    });

    it("shows an inline error without staging a suggestion when generation fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () =>
            new Response(JSON.stringify({ error: "Sabah could not draft this field" }), { status: 502, headers: { "content-type": "application/json" } })
        ));
        const user = userEvent.setup();
        const descriptionField = createField("description", "");
        render(
            <SabahFormProvider formId="task-new" entityType="task" entityId={null} recordVersion={null} fields={[descriptionField]} suggestions={{}}>
                <FieldRow name="description" />
                <FieldAssist fieldName="description" />
                <FormAssistMenu />
            </SabahFormProvider>
        );
        await user.click(screen.getByRole("button", { name: "Sabah assistance for Description" }));
        expect(await screen.findByText("Sabah could not draft this field")).toBeInTheDocument();
        expect(screen.queryByTestId("sabah-field-diff-description")).not.toBeInTheDocument();
        expect(descriptionField.value).toBe("");
    });

    it("normalizes malformed MERGE hashes before sending them to the recorder", async () => {
        const user = userEvent.setup();
        const recorder = vi.fn(async (_input: FeedbackInput) => undefined);
        const field = createField("name", "Current", { merge: (current, proposed) => `${current} + ${proposed}`, hash: async () => "NOT-A-HASH" });
        render(<FormFixture fields={[field]} feedbackRecorder={recorder} suggestions={{ name: { proposed: "Proposed", base: "Current", proposedDiffHash: "A".repeat(64) } }} />);
        await user.click(screen.getByRole("button", { name: /Suggest with diff/i }));
        await user.click(screen.getByRole("button", { name: "Merge" }));
        await waitFor(() => expect(recorder).toHaveBeenCalledOnce());
        const payload = recorder.mock.calls[0][0];
        expect(payload.proposedDiffHash).toMatch(/^[a-f0-9]{64}$/);
        expect(payload.finalDiffHash).toMatch(/^[a-f0-9]{64}$/);
        expect(payload.proposedDiffHash).not.toBe(payload.finalDiffHash);
    });

    it("preserves the feedback-capture warning after a committed merge", async () => {
        const user = userEvent.setup();
        const recorder = vi.fn(async () => { throw new Error("capture unavailable"); });
        const field = createField("name", "Current", { merge: (current, proposed) => `${current} + ${proposed}`, hash: async (value) => value === "Proposed" ? "a".repeat(64) : "b".repeat(64) });
        render(<FormFixture fields={[field]} feedbackRecorder={recorder} suggestions={{ name: { proposed: "Proposed", base: "Current", proposedDiffHash: "a".repeat(64) } }} />);
        await user.click(screen.getByRole("button", { name: /Suggest with diff/i }));
        await user.click(screen.getByRole("button", { name: "Merge" }));

        expect(field.value).toBe("Current + Proposed");
        await waitFor(() => expect(screen.getByRole("list", { name: "Validation errors" })).toHaveTextContent("Saved, but feedback capture is pending"));
    });

    it("preserves the feedback-capture warning after keeping a conflicting value", async () => {
        const user = userEvent.setup();
        const recorder = vi.fn(async () => { throw new Error("capture unavailable"); });
        const field = createField("name", "User edited");
        render(<FormFixture fields={[field]} feedbackRecorder={recorder} suggestions={{ name: { proposed: "Sabah value", base: "Original" } }} />);
        await user.click(screen.getByRole("button", { name: /Suggest with diff/i }));
        await user.click(screen.getByRole("button", { name: "Keep mine" }));

        expect(field.value).toBe("User edited");
        await waitFor(() => expect(screen.getByRole("list", { name: "Validation errors" })).toHaveTextContent("Feedback capture is pending"));
    });
});
