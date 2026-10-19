export type TaskSummaryScope = "selected_sample";
export type TaskSummaryLocale = "en" | "ar";

export interface TaskSummaryFactInput {
    status: string;
    id?: string;
    title?: string;
    dueAt?: string | null;
}

export interface TaskSummaryFacts {
    scope: TaskSummaryScope;
    selectedCount: number;
    statusCounts: Record<string, number>;
}

const STATUS_ORDER = ["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"] as const;
const EN_STATUS_LABELS: Record<string, string> = {
    TODO: "to do",
    DOING: "in progress",
    BLOCKED: "blocked",
    WAITING: "waiting",
    DONE: "done",
    CANCELED: "canceled",
};
const AR_STATUS_LABELS: Record<string, string> = {
    TODO: "للإنجاز",
    DOING: "قيد التنفيذ",
    BLOCKED: "متوقفة",
    WAITING: "قيد الانتظار",
    DONE: "مكتملة",
    CANCELED: "ملغاة",
};

function statusRank(status: string): number {
    const index = STATUS_ORDER.indexOf(status as (typeof STATUS_ORDER)[number]);
    return index === -1 ? STATUS_ORDER.length : index;
}

export function buildTaskSummaryFacts(tasks: readonly TaskSummaryFactInput[]): TaskSummaryFacts {
    const counts = new Map<string, number>();
    for (const task of tasks) {
        const status = task.status.trim().toUpperCase() || "UNKNOWN";
        counts.set(status, (counts.get(status) ?? 0) + 1);
    }

    const statusCounts = Object.fromEntries(
        Array.from(counts.entries()).sort(([left], [right]) => statusRank(left) - statusRank(right) || left.localeCompare(right)),
    );
    return { scope: "selected_sample", selectedCount: tasks.length, statusCounts };
}

export function sameTaskSummaryFacts(left: unknown, right: TaskSummaryFacts): left is TaskSummaryFacts {
    if (typeof left !== "object" || left === null) return false;
    const candidate = left as { scope?: unknown; selectedCount?: unknown; statusCounts?: unknown };
    if (candidate.scope !== right.scope || candidate.selectedCount !== right.selectedCount || typeof candidate.statusCounts !== "object" || candidate.statusCounts === null) return false;
    const candidateCounts = candidate.statusCounts as Record<string, unknown>;
    const rightKeys = Object.keys(right.statusCounts);
    const candidateKeys = Object.keys(candidateCounts);
    return rightKeys.length === candidateKeys.length
        && rightKeys.every((key) => candidateCounts[key] === right.statusCounts[key]);
}

export function formatTaskSummaryFacts(facts: TaskSummaryFacts, locale: TaskSummaryLocale = "en"): string {
    const number = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US");
    const labels = locale === "ar" ? AR_STATUS_LABELS : EN_STATUS_LABELS;
    const statusParts = Object.entries(facts.statusCounts)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => `${number.format(count)} ${labels[status] ?? status.toLowerCase()}`);
    if (locale === "ar") {
        return ["عينة المهام المحددة", `عدد المهام: ${number.format(facts.selectedCount)}`, ...statusParts].join(" · ");
    }
    return ["Selected task sample", `${number.format(facts.selectedCount)} tasks`, ...statusParts].join(" · ");
}
