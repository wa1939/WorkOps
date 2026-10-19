import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, AlertTriangle, Clock, TrendingUp, Calendar, ChevronRight } from "lucide-react";
import Link from "next/link";
import { getInitials, cn } from "@/lib/utils";
import { CapacityHeatmap, type HeatWeek, type HeatUser } from "@/components/team/capacity-heatmap";
import { WorkloadBreakdown, type WorkloadBreakdownState } from "@/components/team/workload-breakdown";
import { DepartmentPulse, type Workstream } from "@/components/team/department-pulse";
import {
    nextWeekWindows,
    saudiWeekStart,
    hoursBreakdownForWindow,
    effectiveCapacity,
    workdaysOnLeave,
    loadEffortMedians,
    type LoadDriver,
} from "@/lib/team-load";

function workloadStateForSnapshot(
    loadPercent: number,
    capacityHours: number,
    unknownTaskCount: number,
): WorkloadBreakdownState {
    if (capacityHours === 0) return "no-capacity";
    if (loadPercent > 100) return "overloaded";
    if (unknownTaskCount > 0) return "unestimated";
    if (loadPercent === 100) return "booked";
    return "available";
}

async function getCapacityData(): Promise<{ weeks: HeatWeek[]; users: HeatUser[]; hasData: boolean }> {
    const windows = nextWeekWindows(4);
    const rangeStart = windows[0].weekStart;
    const rangeEnd = windows[windows.length - 1].weekEnd;

    const [snapshots, users, leaves] = await Promise.all([
        prisma.teamLoadSnapshot.findMany({
            where: { weekStart: { gte: rangeStart, lt: rangeEnd } },
        }),
        prisma.user.findMany({
            where: { isActive: true },
            select: {
                id: true,
                name: true,
                capacityPerWeekHours: true,
                taskAssignments: {
                    select: { task: { select: { id: true, title: true, status: true, dueAt: true, effortHours: true } } },
                },
            },
            orderBy: { name: "asc" },
        }),
        prisma.leaveRequest.findMany({
            where: { status: "Approved", startAt: { lt: rangeEnd }, endAt: { gte: rangeStart } },
            select: { userId: true, startAt: true, endAt: true },
        }),
    ]);

    const snapByUserWeek = new Map<string, {
        loadHours: number;
        loadPercent: number;
        driversJson: string | null;
        unknownTaskCount: number | null;
        backlogCount: number | null;
        confidence: number | null;
        computedAt: Date;
    }>();
    for (const s of snapshots) {
        snapByUserWeek.set(`${s.userId}|${s.weekStart.toISOString()}`, {
            loadHours: s.loadHours,
            loadPercent: s.loadPercent,
            driversJson: s.driversJson,
            unknownTaskCount: s.unknownTaskCount,
            backlogCount: s.backlogCount,
            confidence: s.confidence,
            computedAt: s.computedAt,
        });
    }

    const heatUsers: HeatUser[] = users.map((u) => {
        const open = u.taskAssignments.map((a) => a.task).filter((t) => !["DONE", "CANCELED"].includes(t.status));
        const cells: HeatUser["cells"] = {};
        windows.forEach((w, i) => {
            const key = w.weekStart.toISOString();
            const tasks = open
                .filter((t) => {
                    if (!t.dueAt) return i === 0;
                    const due = new Date(t.dueAt);
                    if (due >= w.weekStart && due < w.weekEnd) return true;
                    if (i === 0 && due < rangeStart) return true;
                    return false;
                })
                .map((t) => ({ id: t.id, title: t.title, effortHours: t.effortHours }));
            const onLeave = leaves.some(
                (l) => l.userId === u.id && new Date(l.startAt) < w.weekEnd && new Date(l.endAt) >= w.weekStart,
            );
            const snap = snapByUserWeek.get(`${u.id}|${key}`);
            let drivers: { title: string; hours: number; source: string }[] | undefined;
            let capacityHours = u.capacityPerWeekHours;
            if (snap?.driversJson) {
                try {
                    const payload = JSON.parse(snap.driversJson) as {
                        capacity?: number;
                        drivers?: { title: string; hours: number; source: string }[];
                    };
                    drivers = payload.drivers;
                    if (typeof payload.capacity === "number" && Number.isFinite(payload.capacity)) {
                        capacityHours = Math.max(0, payload.capacity);
                    }
                } catch {
                    drivers = undefined;
                }
            }
            const plannedHours = snap?.loadHours ?? 0;
            const loadPercent = snap?.loadPercent ?? 0;
            const unknownTaskCount = snap?.unknownTaskCount ?? 0;
            const backlogCount = snap?.backlogCount ?? 0;
            const state = workloadStateForSnapshot(loadPercent, capacityHours, unknownTaskCount);
            const confidence = snap?.confidence == null ? null : `${Math.round(snap.confidence * 100)}%`;
            const computedAt = snap?.computedAt?.toISOString() ?? null;
            const availableHours = Math.max(capacityHours - plannedHours, 0);
            cells[key] = {
                loadPercent,
                plannedHours,
                availableHours,
                capacityHours,
                state,
                unknownTaskCount,
                backlogCount,
                confidence,
                computedAt,
                onLeave,
                tasks,
                drivers,
            };
        });
        return { id: u.id, name: u.name, cells };
    });

    return {
        weeks: windows.map((w) => ({ weekStart: w.weekStart.toISOString(), label: w.label })),
        users: heatUsers,
        hasData: snapshots.length > 0,
    };
}

interface TeammateData {
    id: string;
    name: string;
    email: string;
    image: string | null;
    role: string;
    title: string | null;
    capacityPerWeekHours: number;
    managerId: string | null;
    openTaskCount: number;
    overdueCount: number;
    dueSoonCount: number;
    loadHours: number;
    weekCapacity: number;
    /** Null means the person is fully on leave this week (no capacity to load against). */
    loadPercent: number | null;
    isOnLeave: boolean;
    topTasks: { id: string; title: string; status: string }[];
    topDrivers: LoadDriver[];
}

async function getTeamData(): Promise<TeammateData[]> {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [thisWeek] = nextWeekWindows(1);

    const [users, medians] = await Promise.all([
        prisma.user.findMany({
            where: { isActive: true },
            include: {
                taskAssignments: {
                    include: {
                        task: {
                            select: { id: true, title: true, status: true, priority: true, dueAt: true, effortHours: true, aiEffortHours: true },
                        },
                    },
                },
                leaveRequests: {
                    where: {
                        status: "Approved",
                        startAt: { lt: thisWeek.weekEnd },
                        endAt: { gte: thisWeek.weekStart },
                    },
                    select: { startAt: true, endAt: true },
                },
            },
            orderBy: { name: "asc" },
        }),
        loadEffortMedians(),
    ]);

    return users.map((user) => {
        const openTasks = user.taskAssignments.filter((a) => !["DONE", "CANCELED"].includes(a.task.status));
        const overdueTasks = openTasks.filter((a) => a.task.dueAt && new Date(a.task.dueAt) < now);
        const dueSoonTasks = openTasks.filter((a) => a.task.dueAt && new Date(a.task.dueAt) >= now && new Date(a.task.dueAt) <= nextWeek);

        // Load = this week's due-bucketed effort against leave-adjusted capacity —
        // same engine the forward heatmap uses, so the two never disagree.
        const userMedian = medians.byUser.get(user.id);
        const taskShapes = openTasks.map((a) => ({ title: a.task.title, dueAt: a.task.dueAt, effortHours: a.task.effortHours, aiEffortHours: a.task.aiEffortHours }));
        const { total: loadHours, drivers: topDrivers } = hoursBreakdownForWindow(
            taskShapes, 0, thisWeek, thisWeek.weekStart, userMedian, medians.global,
        );
        const leaveDays = workdaysOnLeave(thisWeek, user.leaveRequests);
        const weekCapacity = effectiveCapacity(user.capacityPerWeekHours, leaveDays);
        const loadPercent = weekCapacity > 0 ? Math.min(Math.round((loadHours / weekCapacity) * 100), 200) : null;
        const isOnLeave = user.leaveRequests.some(
            (l) => new Date(l.startAt) <= now && new Date(l.endAt) >= now,
        );

        const topTasks = openTasks
            .filter((a) => a.task.status === "DOING")
            .concat(openTasks.filter((a) => a.task.status !== "DOING"))
            .slice(0, 3)
            .map((a) => ({ id: a.task.id, title: a.task.title, status: a.task.status }));

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            role: user.role,
            title: user.title,
            capacityPerWeekHours: user.capacityPerWeekHours,
            managerId: user.managerId,
            openTaskCount: openTasks.length,
            overdueCount: overdueTasks.length,
            dueSoonCount: dueSoonTasks.length,
            loadHours,
            weekCapacity,
            loadPercent,
            isOnLeave,
            topTasks,
            topDrivers,
        };
    });
}

/**
 * Load status pairs a color with a word so the signal never rides on color
 * alone. Thresholds match the capacity heatmap's tint() so a person reads the
 * same on the card and in the grid.
 */
function loadStatus(pct: number | null): { label: string; dot: string; text: string } {
    if (pct === null) return { label: "On leave", dot: "bg-muted-foreground/40", text: "text-muted-foreground" };
    if (pct > 100) return { label: "Overloaded", dot: "bg-red-500", text: "text-red-600 dark:text-red-400" };
    if (pct > 85) return { label: "At capacity", dot: "bg-orange-500", text: "text-orange-600 dark:text-orange-400" };
    if (pct >= 60) return { label: "Balanced", dot: "bg-yellow-500", text: "text-yellow-700 dark:text-yellow-400" };
    return { label: "Available", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" };
}

function TeammateCard({ user }: { user: TeammateData }) {
    const status = loadStatus(user.loadPercent);
    return (
        <Card className={cn("h-full", user.isOnLeave && "opacity-70")}>
            <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                    <Avatar className="h-11 w-11 shrink-0">
                        <AvatarImage src={user.image || ""} />
                        <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <CardTitle className="text-base truncate" dir="auto">{user.name}</CardTitle>
                            {user.isOnLeave && (
                                <Badge variant="secondary" className="text-[10px] gap-1 py-0">
                                    <Calendar className="h-3 w-3" /> On leave
                                </Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate" dir="auto">
                            {user.title || user.role}
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="shrink-0 text-muted-foreground">Load this week</span>
                        <span className="flex min-w-0 items-center gap-1.5 font-medium">
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status.dot)} />
                            <span className={cn("shrink-0", status.text)}>{status.label}</span>
                            {user.loadPercent !== null && (
                                <span className="nums shrink-0 text-muted-foreground">· {user.loadPercent}%</span>
                            )}
                            <span className="nums shrink-0 text-muted-foreground/60">· {user.openTaskCount} open</span>
                        </span>
                    </div>
                    {user.loadPercent !== null && (
                        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                            <div
                                className={cn("h-full", status.dot)}
                                style={{ width: `${Math.min(user.loadPercent, 100)}%` }}
                            />
                        </div>
                    )}
                    {user.topDrivers.length > 0 && (
                        <p
                            className="text-[11px] text-muted-foreground truncate"
                            title={user.topDrivers.map((d) => `${d.title} — ${d.hours}h (${d.source})`).join("\n")}
                        >
                            Top load: {user.topDrivers.map((d) => `${d.title.slice(0, 24)} (${d.hours}h)`).join(" · ")}
                        </p>
                    )}
                </div>

                {user.topTasks.length > 0 ? (
                    <div className="space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Working on</p>
                        {user.topTasks.map((t) => (
                            <Link
                                key={t.id}
                                href={`/tasks/${t.id}`}
                                className="flex items-center gap-2 text-sm hover:text-primary transition-colors"
                            >
                                <span className={cn(
                                    "h-1.5 w-1.5 shrink-0 rounded-full",
                                    t.status === "DOING" ? "bg-blue-500" : t.status === "BLOCKED" || t.status === "WAITING" ? "bg-red-500" : "bg-muted-foreground/40"
                                )} />
                                <span className="truncate" dir="auto">{t.title}</span>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground italic">No open tasks.</p>
                )}

                {(user.overdueCount > 0 || user.dueSoonCount > 0) && (
                    <div className="flex gap-3 text-xs pt-1">
                        {user.overdueCount > 0 && (
                            <span className="text-red-500 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" /> <span className="nums">{user.overdueCount}</span> overdue
                            </span>
                        )}
                        {user.dueSoonCount > 0 && (
                            <span className="text-yellow-600 flex items-center gap-1">
                                <Clock className="h-3 w-3" /> <span className="nums">{user.dueSoonCount}</span> due soon
                            </span>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function pickTopTasks(
    tasks: { id: string; title: string; status: string; dueAt: Date | null; assignments: { user: { name: string } }[] }[],
): Workstream["topTasks"] {
    return [...tasks]
        .filter((t) => !["DONE", "CANCELED"].includes(t.status))
        .sort((a, b) => {
            const aDoing = a.status === "DOING" ? 0 : 1;
            const bDoing = b.status === "DOING" ? 0 : 1;
            if (aDoing !== bDoing) return aDoing - bDoing;
            const at = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
            const bt = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
            return at - bt;
        })
        .slice(0, 3)
        .map((t) => ({ id: t.id, title: t.title, status: t.status, assignees: t.assignments.map((a) => a.user.name) }));
}

interface DepartmentPulseData {
    doneThisWeek: number;
    doneLastWeek: number;
    inFlight: number;
    blocked: number;
    dueNext7: number;
    workstreams: Workstream[];
}

async function getDepartmentPulse(): Promise<DepartmentPulseData> {
    const now = new Date();
    const thisWeekStart = saudiWeekStart(now);
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const taskFields = {
        id: true,
        title: true,
        status: true,
        dueAt: true,
        assignments: { select: { user: { select: { name: true } } } },
    } as const;

    const [doneThisWeek, doneLastWeek, inFlight, blocked, dueNext7, activeProjects, generalOpen] = await Promise.all([
        prisma.task.count({ where: { status: "DONE", doneAt: { gte: thisWeekStart } } }),
        prisma.task.count({ where: { status: "DONE", doneAt: { gte: lastWeekStart, lt: thisWeekStart } } }),
        prisma.task.count({ where: { status: "DOING" } }),
        prisma.task.count({ where: { status: { in: ["BLOCKED", "WAITING"] } } }),
        prisma.task.count({ where: { status: { notIn: ["DONE", "CANCELED"] }, dueAt: { gte: now, lte: in7 } } }),
        prisma.project.findMany({
            where: { status: "Active" },
            select: { id: true, name: true, tasks: { select: taskFields } },
            orderBy: { updatedAt: "desc" },
        }),
        prisma.task.findMany({
            where: { projectId: null, status: { notIn: ["DONE", "CANCELED"] } },
            select: taskFields,
        }),
    ]);

    const workstreams: Workstream[] = activeProjects.map((p) => {
        const total = p.tasks.filter((t) => t.status !== "CANCELED").length;
        const done = p.tasks.filter((t) => t.status === "DONE").length;
        const open = p.tasks.filter((t) => !["DONE", "CANCELED"].includes(t.status)).length;
        return {
            id: p.id,
            name: p.name,
            isProject: true,
            openCount: open,
            doneCount: done,
            totalCount: total,
            topTasks: pickTopTasks(p.tasks),
        };
    });

    // Keep only projects that actually have live work, sorted by who is busiest.
    const liveStreams = workstreams
        .filter((w) => w.openCount > 0)
        .sort((a, b) => b.openCount - a.openCount);

    if (generalOpen.length > 0) {
        liveStreams.push({
            id: null,
            name: "General tasks",
            isProject: false,
            openCount: generalOpen.length,
            doneCount: 0,
            totalCount: generalOpen.length,
            topTasks: pickTopTasks(generalOpen),
        });
    }

    return { doneThisWeek, doneLastWeek, inFlight, blocked, dueNext7, workstreams: liveStreams };
}

export default async function TeamPage() {
    const session = await auth();
    if (!session?.user) return null;

    const [teamData, capacity, pulse] = await Promise.all([
        getTeamData(),
        getCapacityData(),
        getDepartmentPulse(),
    ]);
    const canManage = session.user.role === "ADMIN" || session.user.role === "MANAGER";
    const breakdownWeek = capacity.weeks[0];
    const breakdownUser = capacity.users.find((user) => user.id === session.user.id) ?? capacity.users[0];
    const breakdownCell = breakdownUser && breakdownWeek
        ? breakdownUser.cells[breakdownWeek.weekStart]
        : undefined;

    // Build manager tree groups
    const byManager = new Map<string | null, TeammateData[]>();
    for (const u of teamData) {
        const bucket = byManager.get(u.managerId) ?? [];
        bucket.push(u);
        byManager.set(u.managerId, bucket);
    }

    // Root nodes: users with no manager
    const roots = byManager.get(null) ?? [];
    const managersById = new Map(teamData.map((u) => [u.id, u]));

    // Any user who has no manager AND no reports goes into the "individual contributors" section
    const independents = roots.filter((u) => !byManager.has(u.id));

    // Everyone with a manager but whose manager isn't in the team (edge case) falls into "unattached"
    const unattached = teamData.filter((u) => u.managerId && !managersById.has(u.managerId));

    // Depth of a leader within the in-team reporting chain (root managers = 0).
    const depthOf = (u: TeammateData): number => {
        let depth = 0;
        let cursor: TeammateData | undefined = u;
        const seen = new Set<string>();
        while (cursor?.managerId && managersById.has(cursor.managerId) && !seen.has(cursor.id)) {
            seen.add(cursor.id);
            cursor = managersById.get(cursor.managerId);
            depth++;
            if (depth > 20) break; // cycle guard
        }
        return depth;
    };

    // One section per leader (anyone with reports), at EVERY level of the tree — so
    // sub-team-leads and their reports render too, not just the top manager's line.
    const managerSections = teamData
        .filter((u) => byManager.has(u.id))
        .map((leader) => ({
            leader,
            reports: byManager.get(leader.id) ?? [],
            depth: depthOf(leader),
            // Root leaders have no parent group, so their card lives in their own
            // section. Sub-leaders already appear as a card in their manager's
            // group, so we don't repeat their card here — only their reports.
            isRoot: !leader.managerId || !managersById.has(leader.managerId),
            managerName: leader.managerId ? managersById.get(leader.managerId)?.name ?? null : null,
        }))
        .sort((a, b) => a.depth - b.depth || a.leader.name.localeCompare(b.leader.name));

    const totalOverdue = teamData.reduce((sum, u) => sum + u.overdueCount, 0);
    const totalDueSoon = teamData.reduce((sum, u) => sum + u.dueSoonCount, 0);
    const loaded = teamData.filter((u) => u.loadPercent !== null);
    const avgLoad = loaded.length
        ? Math.round(loaded.reduce((sum, u) => sum + (u.loadPercent ?? 0), 0) / loaded.length)
        : 0;
    const onLeaveCount = teamData.filter((u) => u.isOnLeave).length;

    const hierarchyPopulated = managerSections.length > 0;

    return (
        <div className="space-y-6 animate-fade-in">
            <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Team Overview</h1>
                <p className="text-sm text-muted-foreground">Who&apos;s working on what — grouped by the department org tree.</p>
            </div>

            {/* Team Stats — swipeable rail on phones, grid on larger screens */}
            <div className="scroll-touch edge-fade -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 lg:grid-cols-4">
                <Card className="min-w-[150px] shrink-0 md:min-w-0">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Members</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums">{teamData.length}</div>
                        <p className="text-xs text-muted-foreground">{onLeaveCount} on leave</p>
                    </CardContent>
                </Card>
                <Card className={cn("min-w-[150px] shrink-0 md:min-w-0", totalOverdue > 0 && "border-red-500/50")}>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Overdue</CardTitle>
                        <AlertTriangle className={cn("h-4 w-4", totalOverdue > 0 ? "text-red-500" : "text-muted-foreground")} />
                    </CardHeader>
                    <CardContent>
                        <div className={cn("text-2xl font-bold tabular-nums", totalOverdue > 0 && "text-red-500")}>{totalOverdue}</div>
                        <p className="text-xs text-muted-foreground">tasks across team</p>
                    </CardContent>
                </Card>
                <Card className="min-w-[150px] shrink-0 md:min-w-0">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Due Soon</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums">{totalDueSoon}</div>
                        <p className="text-xs text-muted-foreground">next 7 days</p>
                    </CardContent>
                </Card>
                <Card className="min-w-[150px] shrink-0 md:min-w-0">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Avg Load</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums">{avgLoad}%</div>
                        <p className="text-xs text-muted-foreground">this week&apos;s capacity used</p>
                    </CardContent>
                </Card>
            </div>

            {/* Department pulse — what shipped and what's live right now */}
            <section className="space-y-4">
                <div>
                    <h2 className="text-lg font-semibold">Department pulse</h2>
                    <p className="text-sm text-muted-foreground">
                        What the department shipped and is working on right now.
                    </p>
                </div>
                <DepartmentPulse
                    doneThisWeek={pulse.doneThisWeek}
                    doneLastWeek={pulse.doneLastWeek}
                    inFlight={pulse.inFlight}
                    blocked={pulse.blocked}
                    dueNext7={pulse.dueNext7}
                    workstreams={pulse.workstreams}
                />
            </section>

            {capacity.hasData && breakdownUser && breakdownCell && breakdownWeek && (
                <section className="space-y-4">
                    <div>
                        <h2 className="text-lg font-semibold">
                            {breakdownUser.id === session.user.id ? "Your workload" : `${breakdownUser.name}'s workload`}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {breakdownWeek.label} — planned and available hours from the latest capacity snapshot.
                        </p>
                    </div>
                    <div className="max-w-xl">
                        <WorkloadBreakdown
                            personName={breakdownUser.name}
                            plannedHours={breakdownCell.plannedHours ?? 0}
                            availableHours={breakdownCell.availableHours ?? 0}
                            percent={breakdownCell.loadPercent}
                            state={breakdownCell.state ?? workloadStateForSnapshot(
                                breakdownCell.loadPercent,
                                breakdownCell.capacityHours ?? 0,
                                breakdownCell.unknownTaskCount ?? 0,
                            )}
                            unknownTasks={breakdownCell.unknownTaskCount ?? 0}
                            backlogCount={breakdownCell.backlogCount ?? 0}
                            confidence={breakdownCell.confidence}
                            computedAt={breakdownCell.computedAt}
                            perTask={breakdownCell.tasks.flatMap((task) => task.effortHours == null
                                ? []
                                : [{ taskId: task.id, title: task.title, hours: task.effortHours }])}
                        />
                    </div>
                </section>
            )}

            {/* Forward capacity heatmap */}
            <CapacityHeatmap
                weeks={capacity.weeks}
                users={capacity.users}
                canManage={canManage}
                hasData={capacity.hasData}
            />

            {!hierarchyPopulated && (
                <Card className="border-dashed border-purple-500/40 bg-purple-500/5">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm">Org tree not set up yet</CardTitle>
                        <CardDescription>
                            Set each teammate&apos;s manager in <Link href="/admin" className="text-primary underline">Admin → Users → Edit</Link> to see the hierarchy here. Once populated, this page groups by reporting line and the Sunday digest picks up the tree.
                        </CardDescription>
                    </CardHeader>
                </Card>
            )}

            {/* Hierarchy: one section per leader at every level (full tree, flattened top-down) */}
            {managerSections.map(({ leader, reports, depth, managerName, isRoot }) => (
                <section
                    key={leader.id}
                    className="space-y-4"
                    style={depth > 0 ? { marginInlineStart: `clamp(0rem, ${Math.min(depth, 4)} * 2.5vw, ${Math.min(depth, 4)}rem)` } : undefined}
                >
                    <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-semibold">{leader.name}</h2>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                            {reports.length} direct report{reports.length === 1 ? "" : "s"}
                        </span>
                        {managerName && (
                            <span className="text-xs text-muted-foreground/70">· reports to {managerName}</span>
                        )}
                    </div>
                    <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {isRoot && <TeammateCard user={leader} />}
                        {reports.map((r) => (
                            <TeammateCard key={r.id} user={r} />
                        ))}
                    </div>
                </section>
            ))}

            {/* Independents (no manager AND no reports) */}
            {independents.length > 0 && (
                <section className="space-y-4">
                    <h2 className="text-lg font-semibold">Individual contributors</h2>
                    <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {independents.map((u) => (
                            <TeammateCard key={u.id} user={u} />
                        ))}
                    </div>
                </section>
            )}

            {unattached.length > 0 && (
                <section className="space-y-4">
                    <h2 className="text-lg font-semibold text-muted-foreground">Unassigned manager</h2>
                    <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {unattached.map((u) => (
                            <TeammateCard key={u.id} user={u} />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
