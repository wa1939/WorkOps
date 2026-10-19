import type { PlannerMember, PlannerTaskChip } from "@/lib/workload/planner-read-model";

export type PlannerUtilizationBucket = PlannerMember["state"];

export type PlannerFilterState = {
    memberIds: string[];
    projectIds: string[];
    statuses: string[];
    priorities: string[];
    utilizationBuckets: PlannerUtilizationBucket[];
};

export const EMPTY_PLANNER_FILTERS: PlannerFilterState = {
    memberIds: [],
    projectIds: [],
    statuses: [],
    priorities: [],
    utilizationBuckets: [],
};

const FILTER_PARAM_NAMES = [
    "memberIds",
    "projectIds",
    "statuses",
    "priorities",
    "utilization",
] as const;

const UTILIZATION_BUCKETS = new Set<PlannerUtilizationBucket>([
    "available",
    "booked",
    "overloaded",
]);

type PlannerSearchParams = {
    get: (name: string) => string | null;
    getAll: (name: string) => string[];
};

function uniqueValues(values: readonly string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        const normalized = value.trim();
        if (normalized && !seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
}

function valuesFor(params: PlannerSearchParams, name: string): string[] {
    const values: string[] = [];
    for (const rawValue of params.getAll(name)) {
        for (const value of rawValue.split(",")) values.push(value);
    }
    return uniqueValues(values);
}

function validUtilizationBuckets(values: readonly string[]): PlannerUtilizationBucket[] {
    const result: PlannerUtilizationBucket[] = [];
    for (const value of values) {
        if (UTILIZATION_BUCKETS.has(value as PlannerUtilizationBucket)) {
            result.push(value as PlannerUtilizationBucket);
        }
    }
    return result;
}

export function normalizePlannerFilterState(
    filters: Partial<Omit<PlannerFilterState, "utilizationBuckets">> & { utilizationBuckets?: readonly string[] } = {},
): PlannerFilterState {
    return {
        memberIds: uniqueValues(filters.memberIds ?? []),
        projectIds: uniqueValues(filters.projectIds ?? []),
        statuses: uniqueValues(filters.statuses ?? []),
        priorities: uniqueValues(filters.priorities ?? []),
        utilizationBuckets: validUtilizationBuckets(uniqueValues(filters.utilizationBuckets ?? [])),
    };
}

export function parsePlannerFilterState(params: PlannerSearchParams): PlannerFilterState {
    return normalizePlannerFilterState({
        memberIds: valuesFor(params, "memberIds"),
        projectIds: valuesFor(params, "projectIds"),
        statuses: valuesFor(params, "statuses"),
        priorities: valuesFor(params, "priorities"),
        utilizationBuckets: valuesFor(params, "utilization"),
    });
}

export function serializePlannerFilterState(filters: PlannerFilterState): string {
    const normalized = normalizePlannerFilterState(filters);
    const params = new URLSearchParams();
    if (normalized.memberIds.length > 0) params.set("memberIds", normalized.memberIds.join(","));
    if (normalized.projectIds.length > 0) params.set("projectIds", normalized.projectIds.join(","));
    if (normalized.statuses.length > 0) params.set("statuses", normalized.statuses.join(","));
    if (normalized.priorities.length > 0) params.set("priorities", normalized.priorities.join(","));
    if (normalized.utilizationBuckets.length > 0) params.set("utilization", normalized.utilizationBuckets.join(","));
    return params.toString();
}

export function mergePlannerFilterStateIntoUrl(
    current: { toString: () => string },
    filters: PlannerFilterState,
): string {
    const params = new URLSearchParams(current.toString());
    for (const name of FILTER_PARAM_NAMES) params.delete(name);
    const serialized = new URLSearchParams(serializePlannerFilterState(filters));
    serialized.forEach((value, name) => params.set(name, value));
    return params.toString();
}

export function hasPlannerFilters(filters: PlannerFilterState): boolean {
    return filters.memberIds.length > 0
        || filters.projectIds.length > 0
        || filters.statuses.length > 0
        || filters.priorities.length > 0
        || filters.utilizationBuckets.length > 0;
}

export function taskChipMatchesPlannerFilters(
    chip: PlannerTaskChip,
    filters: PlannerFilterState,
): boolean {
    return (filters.projectIds.length === 0 || (chip.projectId != null && filters.projectIds.includes(chip.projectId)))
        && (filters.statuses.length === 0 || filters.statuses.includes(chip.status))
        && (filters.priorities.length === 0 || filters.priorities.includes(chip.priority));
}

export function memberMatchesPlannerFilters(
    member: PlannerMember,
    filters: PlannerFilterState,
): boolean {
    if (filters.memberIds.length > 0 && !filters.memberIds.includes(member.id)) return false;
    if (filters.utilizationBuckets.length > 0 && !filters.utilizationBuckets.includes(member.state)) return false;

    const hasTaskFilters = filters.projectIds.length > 0
        || filters.statuses.length > 0
        || filters.priorities.length > 0;
    if (!hasTaskFilters) return true;

    return member.days.some((day) => day.taskChips.some((chip) => taskChipMatchesPlannerFilters(chip, filters)));
}
