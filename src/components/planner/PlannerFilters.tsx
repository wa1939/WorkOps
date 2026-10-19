"use client";

import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
    EMPTY_PLANNER_FILTERS,
    hasPlannerFilters,
    normalizePlannerFilterState,
    type PlannerFilterState,
} from "./planner-filter-state";
import { cn } from "@/lib/utils";

export type PlannerFilterOption = {
    value: string;
    label: string;
};

type PlannerMultiSelectProps = {
    label: string;
    options: readonly PlannerFilterOption[];
    selectedValues: readonly string[];
    onChange: (values: string[]) => void;
    className?: string;
};

type PlannerFiltersProps = {
    filters: PlannerFilterState;
    memberOptions: readonly PlannerFilterOption[];
    projectOptions: readonly PlannerFilterOption[];
    onChange: (filters: PlannerFilterState) => void;
};

const STATUS_OPTIONS: readonly PlannerFilterOption[] = [
    { value: "TODO", label: "To do" },
    { value: "DOING", label: "In progress" },
    { value: "BLOCKED", label: "Blocked" },
    { value: "WAITING", label: "Waiting" },
    { value: "DONE", label: "Done" },
    { value: "CANCELED", label: "Canceled" },
];

const PRIORITY_OPTIONS: readonly PlannerFilterOption[] = [
    { value: "LOW", label: "Low" },
    { value: "MEDIUM", label: "Medium" },
    { value: "HIGH", label: "High" },
    { value: "URGENT", label: "Urgent" },
];

const UTILIZATION_OPTIONS: readonly PlannerFilterOption[] = [
    { value: "available", label: "Available" },
    { value: "booked", label: "Booked" },
    { value: "overloaded", label: "Overloaded" },
];

function toggleValue(values: readonly string[], value: string): string[] {
    return values.includes(value)
        ? values.filter((current) => current !== value)
        : values.concat(value);
}

function PlannerMultiSelect({
    label,
    options,
    selectedValues,
    onChange,
    className,
}: PlannerMultiSelectProps) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className={cn("min-h-11 gap-1.5 bg-background", className)}>
                    <span>{label}</span>
                    {selectedValues.length > 0 && (
                        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                            {selectedValues.length}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
                <div className="mb-2 px-2 text-xs font-semibold text-muted-foreground">Filter by {label.toLowerCase()}</div>
                {options.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground">No options available.</div>
                ) : (
                    <div className="max-h-64 space-y-1 overflow-y-auto">
                        {options.map((option) => {
                            const checked = selectedValues.includes(option.value);
                            return (
                                <label
                                    key={option.value}
                                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
                                >
                                    <Checkbox
                                        checked={checked}
                                        onCheckedChange={() => onChange(toggleValue(selectedValues, option.value))}
                                        aria-label={option.label}
                                    />
                                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                                </label>
                            );
                        })}
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}

function plannerFilterCount(filters: PlannerFilterState): number {
    return filters.memberIds.length
        + filters.projectIds.length
        + filters.statuses.length
        + filters.priorities.length
        + filters.utilizationBuckets.length;
}

type PlannerFilterControlsProps = PlannerFiltersProps & {
    stacked?: boolean;
};

function PlannerFilterControls({
    filters,
    memberOptions,
    projectOptions,
    onChange,
    stacked = false,
}: PlannerFilterControlsProps) {
    const active = hasPlannerFilters(filters);
    const activeCount = plannerFilterCount(filters);

    return (
        <div
            className={stacked ? "grid gap-2" : "flex flex-wrap items-center gap-2"}
            aria-label={stacked ? undefined : "Planner filters"}
        >
            <div className="flex min-h-11 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Filter className="h-3.5 w-3.5" />
                <span>Filters</span>
                {active && (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-foreground">
                        {activeCount}
                    </span>
                )}
            </div>
            <PlannerMultiSelect
                label="Members"
                options={memberOptions}
                selectedValues={filters.memberIds}
                onChange={(memberIds) => onChange({ ...filters, memberIds })}
                className={stacked ? "w-full justify-between" : undefined}
            />
            <PlannerMultiSelect
                label="Projects"
                options={projectOptions}
                selectedValues={filters.projectIds}
                onChange={(projectIds) => onChange({ ...filters, projectIds })}
                className={stacked ? "w-full justify-between" : undefined}
            />
            <PlannerMultiSelect
                label="Status"
                options={STATUS_OPTIONS}
                selectedValues={filters.statuses}
                onChange={(statuses) => onChange({ ...filters, statuses })}
                className={stacked ? "w-full justify-between" : undefined}
            />
            <PlannerMultiSelect
                label="Priority"
                options={PRIORITY_OPTIONS}
                selectedValues={filters.priorities}
                onChange={(priorities) => onChange({ ...filters, priorities })}
                className={stacked ? "w-full justify-between" : undefined}
            />
            <PlannerMultiSelect
                label="Utilization"
                options={UTILIZATION_OPTIONS}
                selectedValues={filters.utilizationBuckets}
                onChange={(utilizationBuckets) => onChange(normalizePlannerFilterState({ ...filters, utilizationBuckets }))}
                className={stacked ? "w-full justify-between" : undefined}
            />
            {active && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn("min-h-11 px-2 text-xs text-muted-foreground hover:text-foreground", stacked && "w-full justify-start")}
                    onClick={() => onChange(EMPTY_PLANNER_FILTERS)}
                >
                    Clear filters
                </Button>
            )}
        </div>
    );
}

export function PlannerFilters({
    filters,
    memberOptions,
    projectOptions,
    onChange,
}: PlannerFiltersProps) {
    const active = hasPlannerFilters(filters);
    const activeCount = plannerFilterCount(filters);

    return (
        <>
            <div className="md:hidden">
                <Sheet>
                    <SheetTrigger asChild>
                        <Button type="button" variant="outline" className="min-h-11 w-full justify-between bg-background">
                            <span className="flex items-center gap-2">
                                <Filter className="h-4 w-4" />
                                <span>Filters</span>
                                {active && (
                                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                                        {activeCount}
                                    </span>
                                )}
                            </span>
                            <span className="text-xs text-muted-foreground">Adjust</span>
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                        <SheetHeader className="text-left">
                            <SheetTitle>Planner filters</SheetTitle>
                            <SheetDescription>Choose the work and people shown on the planner.</SheetDescription>
                        </SheetHeader>
                        <div className="mt-4 max-h-[60dvh] overflow-y-auto">
                            <PlannerFilterControls
                                filters={filters}
                                memberOptions={memberOptions}
                                projectOptions={projectOptions}
                                onChange={onChange}
                                stacked
                            />
                        </div>
                    </SheetContent>
                </Sheet>
            </div>
            <div className="hidden md:block">
                <PlannerFilterControls
                    filters={filters}
                    memberOptions={memberOptions}
                    projectOptions={projectOptions}
                    onChange={onChange}
                />
            </div>
        </>
    );
}
