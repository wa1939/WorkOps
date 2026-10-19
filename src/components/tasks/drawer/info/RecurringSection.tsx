"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { DrawerRecurringRule, TaskDrawerPayload } from "../types";
import { dateLabel } from "./shared";

const DAYS = [
    { value: 0, label: "Sun" },
    { value: 1, label: "Mon" },
    { value: 2, label: "Tue" },
    { value: 3, label: "Wed" },
    { value: 4, label: "Thu" },
    { value: 5, label: "Fri" },
    { value: 6, label: "Sat" },
] as const;

const FREQUENCIES = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "yearly", label: "Yearly" },
] as const;

const STATUSES = ["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"] as const;
const NTH_WEEKS = [1, 2, 3, 4, 5] as const;

type MonthlyMode = "day" | "nth";

type RecurringSectionProps = {
    task: TaskDrawerPayload;
    onRefresh: () => Promise<void>;
};

function selectedDays(rule: DrawerRecurringRule | null): number[] {
    const days = rule?.byDay?.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) ?? [];
    return days.length ? Array.from(new Set(days)).sort((left, right) => left - right) : [0];
}

function monthlyModeFor(rule: DrawerRecurringRule | null): MonthlyMode {
    return rule?.byMonthDay !== null && rule?.byMonthDay !== undefined ? "day" : "nth";
}

export function RecurringSection({ task, onRefresh }: RecurringSectionProps) {
    const rule = task.recurringRule;
    const [freq, setFreq] = useState(rule?.freq ?? "daily");
    const [interval, setInterval] = useState(String(rule?.interval ?? 1));
    const [byDay, setByDay] = useState<number[]>(() => selectedDays(rule));
    const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>(() => monthlyModeFor(rule));
    const [byMonthDay, setByMonthDay] = useState(String(rule?.byMonthDay ?? 1));
    const [nthWeek, setNthWeek] = useState(String(rule?.nthWeek ?? 2));
    const [weekday, setWeekday] = useState(String(rule?.weekday ?? 2));
    const [mode, setMode] = useState(rule?.mode === "status" ? "status" : "create");
    const [targetStatus, setTargetStatus] = useState(rule?.targetStatus && STATUSES.includes(rule.targetStatus as typeof STATUSES[number]) ? rule.targetStatus : "TODO");
    const [active, setActive] = useState(rule?.active ?? true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const nextRule = task.recurringRule;
        setFreq(nextRule?.freq ?? "daily");
        setInterval(String(nextRule?.interval ?? 1));
        setByDay(selectedDays(nextRule));
        setMonthlyMode(monthlyModeFor(nextRule));
        setByMonthDay(String(nextRule?.byMonthDay ?? 1));
        setNthWeek(String(nextRule?.nthWeek ?? 2));
        setWeekday(String(nextRule?.weekday ?? 2));
        setMode(nextRule?.mode === "status" ? "status" : "create");
        setTargetStatus(nextRule?.targetStatus && STATUSES.includes(nextRule.targetStatus as typeof STATUSES[number]) ? nextRule.targetStatus : "TODO");
        setActive(nextRule?.active ?? true);
        setError(null);
        setSaved(false);
    }, [task.recurringRule]);

    const toggleDay = (day: number) => {
        setByDay((current) => {
            if (current.includes(day)) {
                return current.length === 1 ? current : current.filter((value) => value !== day);
            }
            return [...current, day].sort((left, right) => left - right);
        });
    };

    const save = async () => {
        setSaving(true);
        setError(null);
        setSaved(false);
        try {
            const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/recurrence`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    freq,
                    interval: Math.max(1, Math.floor(Number(interval) || 1)),
                    byDay: freq === "weekly" ? byDay : null,
                    byMonthDay: freq === "monthly" && monthlyMode === "day" ? Math.max(1, Math.min(31, Math.floor(Number(byMonthDay) || 1))) : null,
                    nthWeek: freq === "monthly" && monthlyMode === "nth" ? Math.max(1, Math.min(5, Math.floor(Number(nthWeek) || 1))) : null,
                    weekday: freq === "monthly" && monthlyMode === "nth" ? Number(weekday) : null,
                    mode,
                    targetStatus: mode === "status" ? targetStatus : null,
                    active,
                }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? "Unable to save recurrence");
            await onRefresh();
            setSaved(true);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Unable to save recurrence");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`recurrence-frequency-${task.id}`}>
                    <span>Frequency</span>
                    <select
                        id={`recurrence-frequency-${task.id}`}
                        value={freq}
                        onChange={(event) => setFreq(event.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                        {FREQUENCIES.map((frequency) => <option key={frequency.value} value={frequency.value}>{frequency.label}</option>)}
                    </select>
                </label>
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`recurrence-interval-${task.id}`}>
                    <span>Every</span>
                    <input
                        id={`recurrence-interval-${task.id}`}
                        type="number"
                        min={1}
                        max={1000000}
                        step={1}
                        value={interval}
                        onChange={(event) => setInterval(event.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-ring"
                    />
                </label>
            </div>

            {freq === "weekly" && (
                <fieldset className="space-y-2">
                    <legend className="text-xs font-medium text-muted-foreground">Days of the week</legend>
                    <div className="flex flex-wrap gap-1.5">
                        {DAYS.map((day) => {
                            const selected = byDay.includes(day.value);
                            return (
                                <button
                                    key={day.value}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => toggleDay(day.value)}
                                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-muted-foreground hover:bg-accent"}`}
                                >
                                    {day.label}
                                </button>
                            );
                        })}
                    </div>
                </fieldset>
            )}

            {freq === "monthly" && (
                <fieldset className="space-y-3">
                    <legend className="text-xs font-medium text-muted-foreground">Monthly schedule</legend>
                    <label className="flex items-center gap-2 text-sm text-foreground">
                        <input type="radio" name={`monthly-mode-${task.id}`} checked={monthlyMode === "day"} onChange={() => setMonthlyMode("day")} className="accent-primary" />
                        <span>Day of month</span>
                        {monthlyMode === "day" && (
                            <input type="number" min={1} max={31} value={byMonthDay} onChange={(event) => setByMonthDay(event.target.value)} className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring" aria-label="Day of month" />
                        )}
                    </label>
                    <label className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                        <input type="radio" name={`monthly-mode-${task.id}`} checked={monthlyMode === "nth"} onChange={() => setMonthlyMode("nth")} className="accent-primary" />
                        <span>Occurrence</span>
                        {monthlyMode === "nth" && (
                            <>
                                <select value={nthWeek} onChange={(event) => setNthWeek(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring" aria-label="Week occurrence">
                                    {NTH_WEEKS.map((week) => <option key={week} value={week}>{week}{week === 1 ? "st" : week === 2 ? "nd" : week === 3 ? "rd" : "th"}</option>)}
                                </select>
                                <select value={weekday} onChange={(event) => setWeekday(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring" aria-label="Weekday">
                                    {DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                                </select>
                            </>
                        )}
                    </label>
                    <p className="text-xs text-muted-foreground">Dates such as the 31st skip months that do not contain that day.</p>
                </fieldset>
            )}

            <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-muted-foreground">When it runs</legend>
                <label className="flex items-center gap-2 text-sm text-foreground">
                    <input type="radio" name={`recurrence-mode-${task.id}`} value="create" checked={mode === "create"} onChange={() => setMode("create")} className="accent-primary" />
                    <span>Create a new task</span>
                </label>
                <label className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <input type="radio" name={`recurrence-mode-${task.id}`} value="status" checked={mode === "status"} onChange={() => setMode("status")} className="accent-primary" />
                    <span>Set task status to</span>
                    {mode === "status" && (
                        <select value={targetStatus} onChange={(event) => setTargetStatus(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring" aria-label="Target status">
                            {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                        </select>
                    )}
                </label>
            </fieldset>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                    <p className="text-sm font-medium text-foreground">Active</p>
                    {rule?.nextRunAt && <p className="text-xs text-muted-foreground">Next run {dateLabel(rule.nextRunAt)}</p>}
                </div>
                <Switch checked={active} onCheckedChange={setActive} aria-label="Recurring rule active" />
            </div>

            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            {saved && <p className="text-xs text-emerald-600" role="status">Recurrence saved.</p>}
            <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
                {saving ? "Saving…" : "Save recurrence"}
            </Button>
        </div>
    );
}
