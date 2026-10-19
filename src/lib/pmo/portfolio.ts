import type { Prisma } from "@prisma/client";
import { differenceInCalendarDays, fromRiyadhDate, shiftCalendarDate } from "./date";

export type PmoFilters = {
    ownerId: "me" | string | null;
    workAreaId: string | null;
    parentType: "project" | "case-study" | null;
    parentId: string | null;
    contactId: string | null;
    status: "TODO" | "DOING" | "BLOCKED" | "WAITING" | "DONE" | "CANCELED" | null;
    dueBucket: "OVERDUE" | "DUE_7" | "DUE_30" | null;
    dueStart: string | null;
    dueEnd: string | null;
    evidence: "has" | "missing" | null;
    page: number;
};

function value(input: URLSearchParams | Record<string, string | string[] | undefined>, key: string): string | null {
    if (input instanceof URLSearchParams) return input.get(key);
    const raw = input[key];
    return Array.isArray(raw) ? raw[0] ?? null : raw ?? null;
}

export function parsePmoFilters(input: URLSearchParams | Record<string, string | string[] | undefined>): PmoFilters {
    const owner = value(input, "ownerId");
    const parentType = value(input, "parentType");
    const status = value(input, "status");
    const dueBucket = value(input, "dueBucket");
    const evidence = value(input, "evidence");
    return {
        ownerId: owner === "all" ? null : owner || "me",
        workAreaId: value(input, "workAreaId"),
        parentType: parentType === "project" || parentType === "case-study" ? parentType : null,
        parentId: value(input, "parentId"),
        contactId: value(input, "contactId"),
        status: ["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"].includes(status ?? "") ? status as PmoFilters["status"] : null,
        dueBucket: ["OVERDUE", "DUE_7", "DUE_30"].includes(dueBucket ?? "") ? dueBucket as PmoFilters["dueBucket"] : null,
        dueStart: value(input, "dueStart"),
        dueEnd: value(input, "dueEnd"),
        evidence: evidence === "has" || evidence === "missing" ? evidence : null,
        page: Math.max(1, Number(value(input, "page") ?? 1) || 1),
    };
}

export function buildPmoWhere(filters: PmoFilters, userId: string, today: string): Prisma.TaskWhereInput {
    const due: Prisma.DateTimeNullableFilter = {};
    if (filters.dueBucket === "OVERDUE") due.lt = fromRiyadhDate(today, 0);
    if (filters.dueBucket === "DUE_7") {
        due.gte = fromRiyadhDate(today, 0);
        due.lt = fromRiyadhDate(shiftCalendarDate(today, 8), 0);
    }
    if (filters.dueBucket === "DUE_30") {
        due.gte = fromRiyadhDate(shiftCalendarDate(today, 8), 0);
        due.lt = fromRiyadhDate(shiftCalendarDate(today, 31), 0);
    }
    if (filters.dueStart) due.gte = fromRiyadhDate(filters.dueStart, 0);
    if (filters.dueEnd) due.lt = fromRiyadhDate(shiftCalendarDate(filters.dueEnd, 1), 0);

    return {
        type: "EXTERNAL_ACTION",
        ...(filters.status ? { status: filters.status } : {}),
        ...(Object.keys(due).length ? { dueAt: due } : {}),
        externalAction: {
            is: {
                ...(filters.ownerId ? { ownerId: filters.ownerId === "me" ? userId : filters.ownerId } : {}),
                ...(filters.contactId ? { externalContactId: filters.contactId } : {}),
                ...(filters.evidence === "has" ? { evidence: { some: {} } } : filters.evidence === "missing" ? { evidence: { none: {} } } : {}),
            },
        },
        ...(filters.workAreaId ? { OR: [{ project: { workAreaId: filters.workAreaId } }, { caseStudy: { workAreaId: filters.workAreaId } }] } : {}),
        ...(filters.parentId
            ? filters.parentType === "case-study" ? { caseStudyId: filters.parentId } : { projectId: filters.parentId }
            : filters.parentType === "case-study" ? { caseStudyId: { not: null } } : filters.parentType === "project" ? { projectId: { not: null } } : {}),
    };
}

export type PortfolioRow = { status: string; dueDate: string; closedDate: string | null };
export type PortfolioMetrics = { open: number; dueSoon: number; overdue: number; completed: number; completedOnTime: number; onTimeCompletionRate: number | null };

export function calculatePortfolioMetrics(rows: PortfolioRow[], today: string): PortfolioMetrics {
    let open = 0;
    let dueSoon = 0;
    let overdue = 0;
    let completed = 0;
    let completedOnTime = 0;
    for (const row of rows) {
        if (row.status === "DONE") {
            completed++;
            if (row.closedDate && row.closedDate <= row.dueDate) completedOnTime++;
            continue;
        }
        if (row.status === "CANCELED") continue;
        open++;
        const days = differenceInCalendarDays(today, row.dueDate);
        if (days < 0) overdue++;
        else if (days <= 30) dueSoon++;
    }
    return { open, dueSoon, overdue, completed, completedOnTime, onTimeCompletionRate: completed ? Math.round((completedOnTime / completed) * 100) : null };
}

export function groupPortfolioRows<T extends { workAreaName: string }>(rows: T[]): Record<string, T[]> {
    return [...rows]
        .sort((left, right) => left.workAreaName.localeCompare(right.workAreaName))
        .reduce<Record<string, T[]>>((groups, row) => {
            (groups[row.workAreaName] ??= []).push(row);
            return groups;
        }, {});
}

export function escapeCsvCell(value: unknown): string {
    let text = value == null ? "" : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
