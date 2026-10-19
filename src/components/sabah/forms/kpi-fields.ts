import type { Dispatch, SetStateAction } from "react";
import type { SabahFieldDescriptor } from "./contracts";

export const KPI_FORM_FIELD_NAMES = [
    "perspective", "objective", "name", "definition", "formula", "dataSource", "metric", "unit", "weight",
    "annualTarget", "calculationType", "level1", "level2", "level3", "level4", "level5",
    "q1Target", "q2Target", "q3Target", "q4Target", "trackingPeriod", "status",
] as const;

export type KpiFormValues = Record<string, unknown>;

function isEmpty(value: unknown): boolean {
    return value === "" || value === null || value === undefined;
}

export function createKpiFieldDescriptors(
    values: KpiFormValues,
    setValues: Dispatch<SetStateAction<KpiFormValues>>,
    protectedNames: readonly string[] = [],
): SabahFieldDescriptor[] {
    return KPI_FORM_FIELD_NAMES.map((name) => ({
        name,
        label: name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
        value: values[name] ?? "",
        empty: isEmpty(values[name]),
        protected: protectedNames.includes(name),
        risk: "SENSITIVE_WRITE" as const,
        actions: ["SUGGEST"] as const,
        validate: async (proposed: unknown) => ({ ok: true as const, value: proposed }),
        setValue: (value: unknown) => {
            setValues((current) => ({ ...current, [name]: value }));
            const input = typeof document === "undefined" ? null : document.querySelector<HTMLElement>(`[name="${name}"]`);
            if (input && "value" in input) {
                (input as HTMLInputElement).value = value == null ? "" : String(value);
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        },
    }));
}

export function updateKpiFormValue(setValues: Dispatch<SetStateAction<KpiFormValues>>, name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
}

const numericKpiFields = new Set(["weight", "annualTarget", "level1", "level2", "level3", "level4", "level5", "q1Target", "q2Target", "q3Target", "q4Target"]);

/** Build the API payload from visible controls plus state-backed hidden fields. */
export function serializeKpiFormValues(formData: FormData, values: KpiFormValues): Record<string, unknown> {
    return Object.fromEntries(KPI_FORM_FIELD_NAMES.map((name) => {
        const submitted = formData.get(name);
        const raw = submitted === null ? values[name] : submitted;
        if (numericKpiFields.has(name)) {
            if (raw === "" || raw === null || raw === undefined) return [name, null];
            const parsed = typeof raw === "number" ? raw : Number(raw);
            return [name, Number.isFinite(parsed) ? parsed : null];
        }
        return [name, raw === "" ? null : raw];
    }));
}
