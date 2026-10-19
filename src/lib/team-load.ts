import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { estimateMissingEfforts, type EffortEstimateResult } from "@/lib/ai/effort-estimate";
import type { SnapshotRow } from "@/lib/workload/snapshot";

/**
 * Roll a date back to the most recent Sunday 00:00 UTC. The Saudi work week
 * starts Sunday (same convention as the Sunday digest cron).
 */
export function saudiWeekStart(d: Date): Date {
    const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dow = out.getUTCDay(); // 0 = Sunday
    out.setUTCDate(out.getUTCDate() - dow);
    out.setUTCHours(0, 0, 0, 0);
    return out;
}

export interface WeekWindow {
    weekStart: Date;
    weekEnd: Date; // exclusive
    label: string;
}

export function nextWeekWindows(count: number, from = new Date()): WeekWindow[] {
    const base = saudiWeekStart(from);
    const windows: WeekWindow[] = [];
    for (let i = 0; i < count; i++) {
        const weekStart = new Date(base);
        weekStart.setUTCDate(base.getUTCDate() + i * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setUTCDate(weekStart.getUTCDate() + 7);
        const fmt = (dt: Date) => dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
        const lastDay = new Date(weekEnd);
        lastDay.setUTCDate(weekEnd.getUTCDate() - 1);
        windows.push({ weekStart, weekEnd, label: `${fmt(weekStart)} – ${fmt(lastDay)}` });
    }
    return windows;
}

// ============================================================================
// Load engine — the single source of truth for "how booked is this person".
// Both the /team teammate cards and the forward capacity heatmap route their
// math through these helpers so the two never disagree.
// ============================================================================

export interface EffortMedians {
    byUser: Map<string, number>;
    global: number | null;
}

function medianOf(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Median actualHours per user (>= 3 samples each) plus a global median across
 * ALL logged samples — the fallback when a user has too little history.
 */
export async function loadEffortMedians(): Promise<EffortMedians> {
    const tasks = await prisma.task.findMany({
        where: { status: "DONE", actualHours: { gt: 0 } },
        select: { actualHours: true, assignments: { select: { userId: true } } },
    });

    const byUserSamples = new Map<string, number[]>();
    const all: number[] = [];
    for (const t of tasks) {
        if (t.actualHours == null) continue;
        all.push(t.actualHours);
        for (const a of t.assignments) {
            const arr = byUserSamples.get(a.userId) ?? [];
            arr.push(t.actualHours);
            byUserSamples.set(a.userId, arr);
        }
    }

    const byUser = new Map<string, number>();
    for (const [userId, values] of Array.from(byUserSamples.entries())) {
        if (values.length < 3) continue;
        byUser.set(userId, medianOf(values));
    }
    return { byUser, global: all.length > 0 ? medianOf(all) : null };
}

export const DEFAULT_EFFORT_HOURS = 2;

export type EffortSource = "manual" | "ai" | "median" | "default";

export interface WindowTask {
    title: string;
    dueAt: Date | null;
    effortHours: number | null;
    aiEffortHours?: number | null;
}

export interface LoadDriver {
    title: string;
    hours: number;
    source: EffortSource;
}

/** Effort chain: human estimate > cached AI estimate > user median > global median > 2h floor. */
export function estimateEffortWithSource(
    task: { effortHours: number | null; aiEffortHours?: number | null },
    userMedian?: number,
    globalMedian?: number | null,
): { hours: number; source: EffortSource } {
    if (task.effortHours != null) return { hours: task.effortHours, source: "manual" };
    if (task.aiEffortHours != null) return { hours: task.aiEffortHours, source: "ai" };
    if (userMedian != null) return { hours: userMedian, source: "median" };
    if (globalMedian != null) return { hours: globalMedian, source: "median" };
    return { hours: DEFAULT_EFFORT_HOURS, source: "default" };
}

export function estimateEffort(
    task: { effortHours: number | null; aiEffortHours?: number | null },
    userMedian?: number,
    globalMedian?: number | null,
): number {
    return estimateEffortWithSource(task, userMedian, globalMedian).hours;
}

/**
 * Number of Sun–Thu workdays inside [window.weekStart, window.weekEnd) that any
 * approved leave covers. Range 0–5. Fri/Sat never count (Saudi weekend).
 */
export function workdaysOnLeave(window: WeekWindow, leaves: { startAt: Date; endAt: Date }[]): number {
    let count = 0;
    const cursor = new Date(window.weekStart);
    while (cursor < window.weekEnd) {
        const dow = cursor.getUTCDay(); // 0=Sun .. 6=Sat
        if (dow <= 4) {
            // Sun–Thu
            const dayStart = new Date(cursor);
            const dayEnd = new Date(cursor);
            dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
            const onLeave = leaves.some(
                (l) => new Date(l.startAt) < dayEnd && new Date(l.endAt) >= dayStart,
            );
            if (onLeave) count++;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return count;
}

/** Weekly capacity reduced pro-rata by days on leave (5-day work week), floored at 0. */
export function effectiveCapacity(baseHours: number, leaveDays: number): number {
    return Math.max(0, baseHours * (1 - leaveDays / 5));
}

/** A 200% value is a zero-capacity sentinel; positive-capacity overload is uncapped. */
export function loadPercentForCapacity(hours: number, capacity: number): number {
    return capacity > 0 ? Math.round((hours / capacity) * 100) : hours > 0 ? 200 : 0;
}

/** Per-window effort with the contributing tasks — the "why" behind the number. */
export function hoursBreakdownForWindow(
    tasks: WindowTask[],
    windowIndex: number,
    window: WeekWindow,
    rangeStart: Date,
    userMedian?: number,
    globalMedian?: number | null,
): { total: number; drivers: LoadDriver[] } {
    const contributions: LoadDriver[] = [];
    for (const t of tasks) {
        const inWindow = !t.dueAt
            ? windowIndex === 0
            : (() => {
                  const due = new Date(t.dueAt);
                  if (due >= window.weekStart && due < window.weekEnd) return true;
                  return windowIndex === 0 && due < rangeStart;
              })();
        if (!inWindow) continue;
        const { hours, source } = estimateEffortWithSource(t, userMedian, globalMedian);
        contributions.push({ title: t.title.slice(0, 60), hours, source });
    }
    const total = contributions.reduce((sum, c) => sum + c.hours, 0);
    const drivers = [...contributions].sort((a, b) => b.hours - a.hours).slice(0, 3);
    return { total, drivers };
}

export function hoursForWindow(
    tasks: WindowTask[],
    windowIndex: number,
    window: WeekWindow,
    rangeStart: Date,
    userMedian?: number,
    globalMedian?: number | null,
): number {
    return hoursBreakdownForWindow(tasks, windowIndex, window, rangeStart, userMedian, globalMedian).total;
}

export type TeamLoadEstimate = EffortEstimateResult | {
    candidates: number;
    estimated: number;
    skipped: true;
    reason: "provider_unavailable";
};

/** Run estimation regardless of which credential source is configured. */
export async function runBestEffortEffortEstimation(): Promise<TeamLoadEstimate> {
    try {
        return await estimateMissingEfforts();
    } catch (error) {
        console.error("effort estimation skipped: provider unavailable", error instanceof Error ? error.message : "unknown error");
        return { candidates: 0, estimated: 0, skipped: true, reason: "provider_unavailable" };
    }
}

async function loadTeamLoadInputs(weeks: number) {
    const windows = nextWeekWindows(weeks);
    const rangeStart = windows[0].weekStart;
    const rangeEnd = windows[windows.length - 1].weekEnd;

    const [users, leaves, medians] = await Promise.all([
        prisma.user.findMany({
            where: { isActive: true },
            select: {
                id: true,
                capacityPerWeekHours: true,
                taskAssignments: {
                    select: {
                        task: { select: { status: true, title: true, dueAt: true, effortHours: true, aiEffortHours: true } },
                    },
                },
            },
        }),
        prisma.leaveRequest.findMany({
            where: { status: "Approved", startAt: { lt: rangeEnd }, endAt: { gte: rangeStart } },
            select: { userId: true, startAt: true, endAt: true },
        }),
        loadEffortMedians(),
    ]);

    return { windows, rangeStart, rangeEnd, users, leaves, medians };
}

function hashInputs(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalInputs(inputs: Awaited<ReturnType<typeof loadTeamLoadInputs>>) {
    return {
        windows: inputs.windows.map((window) => ({ weekStart: window.weekStart.toISOString(), weekEnd: window.weekEnd.toISOString() })),
        users: inputs.users
            .map((user) => ({
                id: user.id,
                capacityPerWeekHours: user.capacityPerWeekHours,
                tasks: user.taskAssignments
                    .map(({ task }) => ({
                        status: task.status,
                        title: task.title,
                        dueAt: task.dueAt?.toISOString() ?? null,
                        effortHours: task.effortHours,
                        aiEffortHours: task.aiEffortHours,
                    }))
                    .sort((a, b) => `${a.title}:${a.dueAt ?? ""}`.localeCompare(`${b.title}:${b.dueAt ?? ""}`)),
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        leaves: inputs.leaves
            .map((leave) => ({ userId: leave.userId, startAt: leave.startAt.toISOString(), endAt: leave.endAt.toISOString() }))
            .sort((a, b) => `${a.userId}:${a.startAt}`.localeCompare(`${b.userId}:${b.startAt}`)),
        medians: {
            global: inputs.medians.global,
            byUser: Array.from(inputs.medians.byUser.entries()).sort(([a], [b]) => a.localeCompare(b)),
        },
    };
}

function calendarFingerprint(inputs: Awaited<ReturnType<typeof loadTeamLoadInputs>>): string {
    return hashInputs({
        convention: "saudi-sun-thu-v1",
        windows: inputs.windows.map((window) => ({ weekStart: window.weekStart.toISOString(), weekEnd: window.weekEnd.toISOString() })),
        leaves: inputs.leaves
            .map((leave) => ({ userId: leave.userId, startAt: leave.startAt.toISOString(), endAt: leave.endAt.toISOString() }))
            .sort((a, b) => `${a.userId}:${a.startAt}`.localeCompare(`${b.userId}:${b.startAt}`)),
    });
}

export async function getTeamLoadVersions(weeks = 4): Promise<{ inputVersion: string; calendarVersion: string }> {
    const inputs = await loadTeamLoadInputs(weeks);
    const calendarVersion = calendarFingerprint(inputs);
    return { inputVersion: hashInputs({ calendarVersion, inputs: canonicalInputs(inputs) }), calendarVersion };
}

export interface TeamLoadSnapshotComputation {
    rows: SnapshotRow[];
    inputVersion: string;
    calendarVersion: string;
    summary: { users: number; weeks: number; rowsWritten: number; estimate: TeamLoadEstimate };
    rangeStart: Date;
    rangeEnd: Date;
}

/** Compute rows without writing them, so the caller can publish atomically. */
export async function computeTeamLoadSnapshot(weeks = 4): Promise<TeamLoadSnapshotComputation> {
    // Best-effort AI estimation. The explicit skipped marker keeps a provider
    // outage from being reported as successful estimates while load snapshots
    // continue to compute from manual/cached/default effort sources.
    const estimate = await runBestEffortEffortEstimation();
    const inputs = await loadTeamLoadInputs(weeks);
    const { windows, rangeStart, rangeEnd, users, leaves, medians } = inputs;
    const calendarVersion = calendarFingerprint(inputs);
    const inputVersion = hashInputs({ calendarVersion, inputs: canonicalInputs(inputs) });

    const leavesByUser = new Map<string, { startAt: Date; endAt: Date }[]>();
    for (const leave of leaves) {
        const arr = leavesByUser.get(leave.userId) ?? [];
        arr.push({ startAt: leave.startAt, endAt: leave.endAt });
        leavesByUser.set(leave.userId, arr);
    }

    const rows: SnapshotRow[] = [];
    for (const user of users) {
        const openTasks = user.taskAssignments
            .map((assignment) => assignment.task)
            .filter((task) => !["DONE", "CANCELED"].includes(task.status));
        const userLeaves = leavesByUser.get(user.id) ?? [];
        const userMedian = medians.byUser.get(user.id);
        const unknownTaskCount = openTasks.filter(
            (task) => estimateEffortWithSource(task, userMedian, medians.global).source === "default",
        ).length;
        const backlogCount = openTasks.length;
        const confidence = backlogCount === 0 ? 1 : 1 - unknownTaskCount / backlogCount;

        for (let i = 0; i < windows.length; i++) {
            const window = windows[i];
            const { total: hours, drivers } = hoursBreakdownForWindow(
                openTasks, i, window, rangeStart, userMedian, medians.global,
            );
            const leaveDays = workdaysOnLeave(window, userLeaves);
            const capacity = effectiveCapacity(user.capacityPerWeekHours || 35, leaveDays);
            const loadPercent = loadPercentForCapacity(hours, capacity);
            const driversJson = JSON.stringify({
                hours: Math.round(hours * 10) / 10,
                capacity: Math.round(capacity * 10) / 10,
                leaveDays,
                drivers,
            });
            rows.push({
                userId: user.id,
                weekStart: window.weekStart,
                loadHours: hours,
                loadPercent,
                driversJson,
                unknownTaskCount,
                backlogCount,
                confidence,
            });
        }
    }

    return {
        rows,
        inputVersion,
        calendarVersion,
        summary: { users: users.length, weeks, rowsWritten: rows.length, estimate },
        rangeStart,
        rangeEnd,
    };
}

/**
 * Compute forward capacity load per active user for the next `weeks` week-windows
 * and upsert a TeamLoadSnapshot per (userId, weekStart). Leave-aware: a week with
 * days off has proportionally lower capacity, so the same task load reads hotter.
 */
export async function computeTeamLoad(weeks = 4) {
    const computed = await computeTeamLoadSnapshot(weeks);
    const computedAt = new Date();
    for (const row of computed.rows) {
        await prisma.teamLoadSnapshot.upsert({
            where: { userId_weekStart: { userId: row.userId, weekStart: row.weekStart } },
            update: {
                loadHours: row.loadHours,
                loadPercent: row.loadPercent,
                driversJson: row.driversJson ?? null,
                computedAt,
                inputVersion: computed.inputVersion,
                calendarVersion: computed.calendarVersion,
                unknownTaskCount: row.unknownTaskCount ?? null,
                backlogCount: row.backlogCount ?? null,
                confidence: row.confidence ?? null,
            },
            create: {
                userId: row.userId,
                weekStart: row.weekStart,
                loadHours: row.loadHours,
                loadPercent: row.loadPercent,
                driversJson: row.driversJson ?? null,
                computedAt,
                inputVersion: computed.inputVersion,
                calendarVersion: computed.calendarVersion,
                unknownTaskCount: row.unknownTaskCount ?? null,
                backlogCount: row.backlogCount ?? null,
                confidence: row.confidence ?? null,
            },
        });
    }

    // Prune stale snapshots outside the current range so old weeks don't linger.
    await prisma.teamLoadSnapshot.deleteMany({
        where: { OR: [{ weekStart: { lt: computed.rangeStart } }, { weekStart: { gte: computed.rangeEnd } }] },
    });

    return computed.summary;
}
