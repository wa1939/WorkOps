import { describe, expect, it, vi } from "vitest";
import { createKpiFieldDescriptors, KPI_FORM_FIELD_NAMES, serializeKpiFormValues } from "./kpi-fields";

describe("KPI Sabah field descriptors", () => {
    it("covers every canonical mutable KPI field with a state-backed adapter", async () => {
        let state: Record<string, unknown> = { name: "Revenue", level1: 40 };
        const setState = (update: (current: Record<string, unknown>) => Record<string, unknown>) => { state = update(state); };
        const fields = createKpiFieldDescriptors(state, setState as any);
        expect(fields.map((field) => field.name)).toEqual([...KPI_FORM_FIELD_NAMES]);
        expect(fields.every((field) => field.actions.length > 0 && typeof field.validate === "function" && typeof field.setValue === "function")).toBe(true);
        const name = fields.find((field) => field.name === "name")!;
        name.setValue("Updated Revenue");
        expect(state.name).toBe("Updated Revenue");
        await expect(name.validate("Suggested Revenue")).resolves.toEqual({ ok: true, value: "Suggested Revenue" });
    });

    it("marks existing values non-empty and preserves protected fields", () => {
        const fields = createKpiFieldDescriptors({ name: "Revenue", status: "ON_TRACK" }, vi.fn() as any, ["status"]);
        expect(fields.find((field) => field.name === "name")).toMatchObject({ value: "Revenue", empty: false, protected: false });
        expect(fields.find((field) => field.name === "status")).toMatchObject({ value: "ON_TRACK", empty: false, protected: true });
    });

    it("serializes every canonical field and preserves hidden edit values", () => {
        const form = new FormData();
        form.set("name", "Changed");
        const values = Object.fromEntries(KPI_FORM_FIELD_NAMES.map((name) => [name, ["level1", "level2", "level3", "level4", "level5"].includes(name) ? 50 : `${name}-existing`])) as Record<string, unknown>;
        const payload = serializeKpiFormValues(form, values);
        expect(Object.keys(payload)).toEqual(expect.arrayContaining([...KPI_FORM_FIELD_NAMES]));
        expect(payload.formula).toBe("formula-existing");
        expect(payload.level5).toBe(50);
        expect(payload.status).toBe("status-existing");
        expect(payload.name).toBe("Changed");
    });
});
