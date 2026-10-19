"use client";

import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";

export type PlannerSettings = {
    workingDays: number[];
    dailyHours: number;
    showWeekends: boolean;
    defaultEstimateHours: number;
};

export const DEFAULT_PLANNER_SETTINGS: PlannerSettings = {
    workingDays: [0, 1, 2, 3, 4],
    dailyHours: 7,
    showWeekends: false,
    defaultEstimateHours: 1,
};

const WEEK_DAYS: readonly { value: number; label: string }[] = [
    { value: 0, label: "Sun" },
    { value: 1, label: "Mon" },
    { value: 2, label: "Tue" },
    { value: 3, label: "Wed" },
    { value: 4, label: "Thu" },
    { value: 5, label: "Fri" },
    { value: 6, label: "Sat" },
];

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

export function normalizePlannerSettings(value: unknown): PlannerSettings {
    if (value === null || typeof value !== "object") return DEFAULT_PLANNER_SETTINGS;
    const candidate = value as Partial<PlannerSettings>;
    const rawWorkingDays = Array.isArray(candidate.workingDays)
        ? candidate.workingDays.filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6)
        : DEFAULT_PLANNER_SETTINGS.workingDays;
    const workingDays = Array.from(new Set(rawWorkingDays)).sort((left, right) => left - right);
    const dailyHours = typeof candidate.dailyHours === "number" && Number.isFinite(candidate.dailyHours)
        ? clamp(candidate.dailyHours, 1, 24)
        : DEFAULT_PLANNER_SETTINGS.dailyHours;
    const defaultEstimateHours = typeof candidate.defaultEstimateHours === "number" && Number.isFinite(candidate.defaultEstimateHours)
        ? clamp(candidate.defaultEstimateHours, 0.5, 24)
        : DEFAULT_PLANNER_SETTINGS.defaultEstimateHours;

    return {
        workingDays,
        dailyHours,
        showWeekends: typeof candidate.showWeekends === "boolean"
            ? candidate.showWeekends
            : DEFAULT_PLANNER_SETTINGS.showWeekends,
        defaultEstimateHours,
    };
}

type PlannerSettingsDrawerProps = {
    settings: PlannerSettings;
    onChange: (settings: PlannerSettings) => void;
};

export function PlannerSettingsDrawer({ settings, onChange }: PlannerSettingsDrawerProps) {
    function update(patch: Partial<PlannerSettings>) {
        onChange({ ...settings, ...patch });
    }

    function toggleWorkingDay(day: number) {
        const workingDays = settings.workingDays.includes(day)
            ? settings.workingDays.filter((current) => current !== day)
            : Array.from(new Set(settings.workingDays.concat(day))).sort((left, right) => left - right);
        update({ workingDays });
    }

    function updateDailyHours(value: string) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) update({ dailyHours: clamp(parsed, 1, 24) });
    }

    function updateDefaultEstimate(value: string) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) update({ defaultEstimateHours: clamp(parsed, 0.5, 24) });
    }

    return (
        <Sheet>
            <SheetTrigger asChild>
                <Button type="button" variant="outline" size="icon" aria-label="Open planner settings">
                    <Settings2 className="h-4 w-4" />
                </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
                <SheetHeader>
                    <SheetTitle>Planner settings</SheetTitle>
                    <SheetDescription>
                        Adjust the planner view and the capacity inputs used for this range.
                    </SheetDescription>
                </SheetHeader>

                <div className="space-y-6 py-6">
                    <section className="space-y-3">
                        <div>
                            <h3 className="text-sm font-semibold">Working days</h3>
                            <p className="text-xs text-muted-foreground">Sun–Thu is the default work week.</p>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                            {WEEK_DAYS.map((day) => (
                                <label
                                    key={day.value}
                                    className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm hover:bg-accent"
                                >
                                    <Checkbox
                                        checked={settings.workingDays.includes(day.value)}
                                        onCheckedChange={() => toggleWorkingDay(day.value)}
                                        aria-label={`${day.label} working day`}
                                    />
                                    <span>{day.label}</span>
                                </label>
                            ))}
                        </div>
                    </section>

                    <section className="space-y-2">
                        <label className="text-sm font-semibold" htmlFor="planner-daily-hours">Hours per day</label>
                        <input
                            id="planner-daily-hours"
                            type="number"
                            min="1"
                            max="24"
                            step="0.5"
                            value={settings.dailyHours}
                            onChange={(event) => updateDailyHours(event.target.value)}
                            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        />
                        <p className="text-xs text-muted-foreground">Used as the planner&apos;s daily capacity override.</p>
                    </section>

                    <section className="flex items-center justify-between gap-4 rounded-lg border p-3">
                        <div>
                            <h3 className="text-sm font-semibold">Show weekends</h3>
                            <p className="text-xs text-muted-foreground">Display-only; it does not make weekends working days.</p>
                        </div>
                        <Switch
                            checked={settings.showWeekends}
                            onCheckedChange={(showWeekends) => update({ showWeekends })}
                            aria-label="Show weekends"
                        />
                    </section>

                    <section className="space-y-2">
                        <label className="text-sm font-semibold" htmlFor="planner-default-estimate">Default estimate for unestimated tasks</label>
                        <div className="flex items-center gap-2">
                            <input
                                id="planner-default-estimate"
                                type="number"
                                min="0.5"
                                max="24"
                                step="0.5"
                                value={settings.defaultEstimateHours}
                                onChange={(event) => updateDefaultEstimate(event.target.value)}
                                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                            />
                            <span className="text-sm text-muted-foreground">hours</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Display policy only. The planning engine keeps explicit unknown effort values unestimated.
                        </p>
                    </section>
                </div>
            </SheetContent>
        </Sheet>
    );
}
