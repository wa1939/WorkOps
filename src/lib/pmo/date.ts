export const RIYADH_TIME_ZONE = "Asia/Riyadh";
export type PmoDueBucket = "OVERDUE" | "DUE_7" | "DUE_30" | "LATER" | "CLOSED";

const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

export function toRiyadhDate(value: Date): string {
    const parts = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function fromRiyadhDate(date: string, hour = 9): Date {
    return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+03:00`);
}

export function toDatabaseDate(date: string): Date {
    return new Date(`${date}T12:00:00.000Z`);
}

export function shiftCalendarDate(date: string, days: number): string {
    const value = new Date(`${date}T12:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

export function differenceInCalendarDays(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86_400_000);
}

export function getDueBucket(dueDate: string, status: string, today: string): PmoDueBucket {
    if (status === "DONE" || status === "CANCELED") return "CLOSED";
    const days = differenceInCalendarDays(today, dueDate);
    if (days < 0) return "OVERDUE";
    if (days <= 7) return "DUE_7";
    if (days <= 30) return "DUE_30";
    return "LATER";
}
