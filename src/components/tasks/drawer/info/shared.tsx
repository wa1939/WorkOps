import type { DrawerUser } from "../types";

export function userLabel(user: DrawerUser | null | undefined): string {
    return user?.name || user?.email || "Unknown user";
}

export function initials(user: DrawerUser | null | undefined): string {
    const label = userLabel(user);
    return label.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function humanize(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
}

export function dateInputValue(value: string | null | undefined): string {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function dateLabel(value: string | null | undefined): string {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

export function minutesLabel(value: number | null | undefined): string {
    if (!value || value <= 0) return "—";
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return hours > 0 ? `${hours}h${minutes ? ` ${minutes}m` : ""}` : `${minutes}m`;
}
