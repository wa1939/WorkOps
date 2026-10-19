export type PmoSettingsTab = "areas" | "contacts";

export function parsePmoSettingsTab(value: unknown): PmoSettingsTab {
    return value === "contacts" ? "contacts" : "areas";
}
