// @vitest-environment jsdom
import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import "../sabah/test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SabahFormProvider, useSabahForm } from "../sabah/forms/form-context";
import { StrategicProjectFields } from "./strategic-project-fields";
import type { SabahFieldDescriptor } from "../sabah/forms/contracts";

function renderFields(values: Record<string, unknown> = {}) {
    const fields: SabahFieldDescriptor[] = [];
    function Fixture() {
        const [current, setCurrent] = useState(values);
        return <SabahFormProvider formId="project-test" entityType="project" entityId={null} recordVersion={null} fields={fields}>
            <StrategicProjectFields value={current} onChange={setCurrent} />
        </SabahFormProvider>;
    }
    return render(<Fixture />);
}

function DescriptorProbe() {
    const form = useSabahForm();
    const [validation, setValidation] = useState<Record<string, boolean>>({});
    React.useEffect(() => {
        Promise.all([
            form.getField("managerId")?.validate("not-a-cuid"),
            form.getField("sponsorStatus")?.validate("not-an-enum"),
            form.getField("makeFloating")?.validate(true),
        ]).then(([manager, sponsor, floating]) => setValidation({ manager: manager?.ok === false, sponsor: sponsor?.ok === false, floating: floating?.ok === true }));
    }, [form.snapshot.fields, form.getField]);
    return <output data-testid="descriptor-probe">{JSON.stringify({ fields: form.snapshot.fields, validation })}</output>;
}

function renderWithProbe(values: Record<string, unknown> = {}) {
    const fields: SabahFieldDescriptor[] = [];
    function Fixture() {
        const [current, setCurrent] = useState(values);
        return <SabahFormProvider formId="project-test" entityType="project" entityId={null} recordVersion={null} fields={fields}>
            <StrategicProjectFields value={current} onChange={setCurrent} />
            <DescriptorProbe />
        </SabahFormProvider>;
    }
    return render(<Fixture />);
}

describe("StrategicProjectFields", () => {
    it("renders governance, outcomes, priority, health, children, and derived duration", () => {
        renderFields({ startAt: "2026-01-01", dueAt: "2026-03-31" });
        expect(screen.getByRole("combobox", { name: "Responsible administration" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Project manager" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Sponsor status" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Sponsor person" })).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "Objective" })).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "Scope" })).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "Success criteria" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Priority" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Health" })).toBeInTheDocument();
        expect(screen.getByText("3 months")).toBeVisible();
        expect(screen.getByRole("button", { name: /Add objective/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Add output/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Add risk/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Add stage/i })).toBeInTheDocument();
    });

    it("adds dynamic children with stable keyed controls and typed values", async () => {
        const user = userEvent.setup();
        renderFields();
        await user.click(screen.getByRole("button", { name: /Add objective/i }));
        await user.click(screen.getByRole("button", { name: /Add output/i }));
        await user.click(screen.getByRole("button", { name: /Add risk/i }));
        await user.click(screen.getByRole("button", { name: /Add stage/i }));
        expect(screen.getByLabelText(/Objective 1 statement/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Output 1 title/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Risk 1 title/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Stage 1 name/i)).toBeInTheDocument();
    });

    it("rejects invalid required values and never overwrites existing user values", async () => {
        const user = userEvent.setup();
        renderFields({ name: "Existing project", objective: "Existing objective" });
        const name = screen.getByRole("textbox", { name: "Project name" });
        expect(name).toHaveValue("Existing project");
        await user.clear(name);
        await user.tab();
        expect(screen.getByRole("alert")).toHaveTextContent(/at least 1 character|required/i);
        expect(screen.getByRole("textbox", { name: "Objective" })).toHaveValue("Existing objective");
    });

    it("registers canonical descriptors for scalar, date, floating, work-area, and child collections", async () => {
        renderWithProbe({ workAreaId: "c123456789012345678901234" });
        const probe = () => JSON.parse(screen.getByTestId("descriptor-probe").textContent ?? "{}");
        await waitFor(() => expect(Object.keys(probe().fields)).toEqual(expect.arrayContaining(["name", "startAt", "dueAt", "makeFloating", "workAreaId", "objectives", "outputs", "risks", "stages"])));
        await waitFor(() => expect(probe().validation).toEqual({ manager: true, sponsor: true, floating: true }));
    });

    it("exposes accessible governance selectors and preserves explicit floating null", async () => {
        const user = userEvent.setup();
        renderFields({ managerId: "c123456789012345678901234", sponsorId: "c123456789012345678901235", responsibleDepartmentId: "c123456789012345678901236" });
        expect(screen.getByRole("combobox", { name: "Responsible administration" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Project manager" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Sponsor person" })).toBeInTheDocument();
        await user.click(screen.getByRole("checkbox", { name: /Make Floating/i }));
    });

    it("rejects non-canonical IDs and enum values through descriptor validation", async () => {
        renderWithProbe();
        const probe = () => JSON.parse(screen.getByTestId("descriptor-probe").textContent ?? "{}");
        await waitFor(() => expect(probe().validation).toEqual({ manager: true, sponsor: true, floating: true }));
    });
});
