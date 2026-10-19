import type { Priority, TaskStatus } from "@prisma/client";
import { differenceInCalendarDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { DEFAULT_TIME_ZONE } from "../workload/calendar";

export type DueDateSemantic = "overdue" | "today" | "tomorrow" | "upcoming";
export type DateInput = Date | string | number;

export const STATUS_TOKEN_CLASSES = {
    TODO: "bg-[hsl(var(--status-todo))] text-[hsl(var(--status-todo-fg))]",
    DOING: "bg-[hsl(var(--status-doing))] text-[hsl(var(--status-doing-fg))]",
    BLOCKED: "bg-[hsl(var(--status-blocked))] text-[hsl(var(--status-blocked-fg))]",
    WAITING: "bg-[hsl(var(--status-waiting))] text-[hsl(var(--status-waiting-fg))]",
    DONE: "bg-[hsl(var(--status-done))] text-[hsl(var(--status-done-fg))]",
    CANCELED: "bg-[hsl(var(--status-canceled))] text-[hsl(var(--status-canceled-fg))]",
} as const satisfies Record<TaskStatus, string>;

const STATUS_TOKEN_FILL_COLORS: Record<string, string> = {
    TODO: "hsl(var(--status-todo))",
    DOING: "hsl(var(--status-doing))",
    IN_PROGRESS: "hsl(var(--status-doing))",
    BLOCKED: "hsl(var(--status-blocked))",
    WAITING: "hsl(var(--status-waiting))",
    DONE: "hsl(var(--status-done))",
    CANCELED: "hsl(var(--status-canceled))",
};

export function statusFillColor(status: string): string {
    return STATUS_TOKEN_FILL_COLORS[status] ?? "hsl(var(--primary))";
}

export const PRIORITY_TOKEN_CLASSES = {
    LOW: "bg-[hsl(var(--priority-low))] text-[hsl(var(--priority-low-fg))]",
    MEDIUM: "bg-[hsl(var(--priority-medium))] text-[hsl(var(--priority-medium-fg))]",
    HIGH: "bg-[hsl(var(--priority-high))] text-[hsl(var(--priority-high-fg))]",
    URGENT: "bg-[hsl(var(--priority-urgent))] text-[hsl(var(--priority-urgent-fg))]",
} as const satisfies Record<Priority, string>;

export const DUE_TOKEN_CLASSES = {
    overdue: "bg-[hsl(var(--due-overdue))] text-[hsl(var(--due-overdue-fg))]",
    today: "bg-[hsl(var(--due-today))] text-[hsl(var(--due-today-fg))]",
    tomorrow: "bg-[hsl(var(--due-tomorrow))] text-[hsl(var(--due-tomorrow-fg))]",
    upcoming: "bg-[hsl(var(--due-upcoming))] text-[hsl(var(--due-upcoming-fg))]",
} as const satisfies Record<DueDateSemantic, string>;

function asValidDate(value: DateInput, label: string): Date {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new RangeError(`Invalid ${label}`);
    }
    return date;
}

function calendarDayAtNoon(value: DateInput, label: string): Date {
    const date = asValidDate(value, label);
    const datePart = formatInTimeZone(date, DEFAULT_TIME_ZONE, "yyyy-MM-dd");
    return fromZonedTime(`${datePart}T12:00:00`, DEFAULT_TIME_ZONE);
}

export function statusClass(status: TaskStatus): string {
    return STATUS_TOKEN_CLASSES[status] ?? "";
}

export function priorityClass(priority: Priority): string {
    return PRIORITY_TOKEN_CLASSES[priority] ?? "";
}

export function dueDateSemantics(
    dueDate: DateInput,
    now: DateInput = new Date(),
): DueDateSemantic {
    const dueDay = calendarDayAtNoon(dueDate, "due date");
    const today = calendarDayAtNoon(now, "current date");
    const daysUntilDue = differenceInCalendarDays(dueDay, today);

    if (daysUntilDue < 0) return "overdue";
    if (daysUntilDue === 0) return "today";
    if (daysUntilDue === 1) return "tomorrow";
    return "upcoming";
}

export function dueClass(
    dueDate: DateInput | null | undefined,
    now: DateInput = new Date(),
): string {
    if (dueDate == null) return "";
    return DUE_TOKEN_CLASSES[dueDateSemantics(dueDate, now)];
}
