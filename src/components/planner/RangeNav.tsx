"use client";

import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PlannerRange } from "./range-utils";

export type RangeNavProps = {
    range: PlannerRange;
    label: string;
    loading: boolean;
    onRangeChange: (range: PlannerRange) => void;
    onNavigate: (direction: 1 | -1) => void;
    onToday: () => void;
    onRefresh: () => void;
};

const RANGE_OPTIONS: Array<{ value: PlannerRange; label: string; description: string }> = [
    { value: "day", label: "Day", description: "One working day" },
    { value: "week", label: "Week", description: "Seven-day window" },
    { value: "month", label: "Month", description: "Four-week rollup" },
];

export function RangeNav({
    range,
    label,
    loading,
    onRangeChange,
    onNavigate,
    onToday,
    onRefresh,
}: RangeNavProps) {
    return (
        <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <div className="flex items-center gap-1 rounded-full border bg-card p-1" role="group" aria-label="Planner range">
                {RANGE_OPTIONS.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={range === option.value}
                        title={option.description}
                        onClick={() => onRangeChange(option.value)}
                        className={cn(
                            "min-h-11 rounded-full px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                            range === option.value
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" className="min-h-11 min-w-11 px-2" onClick={() => onNavigate(-1)} aria-label="Previous range">
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="sm" className="min-h-11 px-3" onClick={onToday}>
                    <CalendarDays className="mr-1.5 h-4 w-4" />
                    Today
                </Button>
                <Button type="button" variant="outline" size="sm" className="min-h-11 min-w-11 px-2" onClick={() => onNavigate(1)} aria-label="Next range">
                    <ChevronRight className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="min-h-11 min-w-11 px-2" onClick={onRefresh} disabled={loading} aria-label="Refresh planner">
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                </Button>
            </div>
            <div className="hidden min-w-[170px] text-right text-sm font-semibold sm:block">{label}</div>
        </div>
    );
}
