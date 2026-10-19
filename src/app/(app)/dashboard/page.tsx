import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
    AlertTriangle,
    Plus,
    Target,
    Star,
    Sparkles,
    Users,
    ArrowRight,
    Zap,
    Clock,
    Flame,
    CheckCircle2,
    Hand,
} from "lucide-react";
import Link from "next/link";
import { calculateUrgencyScore, cn } from "@/lib/utils";
import { FocusPanel } from "@/components/dashboard/focus-panel";
import { WelcomeHeader } from "@/components/dashboard/welcome-header";
import { WeatherWidget } from "@/components/dashboard/weather-widget";
import { DailyQuote } from "@/components/dashboard/daily-quote";
import { StreakWidget } from "@/components/dashboard/streak-widget";
import { TeamActivity } from "@/components/dashboard/team-activity";
import { QuickNoteDialog } from "@/components/dashboard/quick-note-dialog";
import { DashboardAnnouncements } from "@/components/announcements/dashboard-announcements";
import { StaggerContainer, StaggerItem } from "@/components/motion/stagger-container";
import { AnimatedNumber } from "@/components/motion/animated-number";

async function getDashboardData(userId: string) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get MY tasks (assigned to me)
    const myTasks = await prisma.task.findMany({
        where: {
            assignments: { some: { userId } },
            status: { notIn: ["DONE", "CANCELED"] },
        },
        include: {
            assignments: { include: { user: true } },
            project: true,
        },
        orderBy: [
            { priority: "desc" },
            { dueAt: "asc" },
        ],
        take: 250,
    });

    // Get floating pool (unassigned tasks)
    const floatingTasks = await prisma.task.findMany({
        where: {
            assignments: { none: {} },
            status: { notIn: ["DONE", "CANCELED"] },
        },
        include: {
            assignments: { include: { user: true } },
            project: true,
        },
        orderBy: [
            { priority: "desc" },
            { dueAt: "asc" },
        ],
        take: 5,
    });

    // Score every open task; the Focus panel filters these by range on the client so
    // switching Today / This week / All is instant.
    const focusTasks = myTasks
        .map((task) => ({
            ...task,
            urgencyScore: calculateUrgencyScore(task),
        }))
        .sort((a, b) => b.urgencyScore - a.urgencyScore);

    // Stats
    const urgentCount = myTasks.filter(t => t.priority === "URGENT").length;
    const overdueCount = myTasks.filter(t => t.dueAt && new Date(t.dueAt) < now).length;
    const dueTodayCount = myTasks.filter(t => {
        if (!t.dueAt) return false;
        const dueDate = new Date(t.dueAt);
        return dueDate.toDateString() === now.toDateString();
    }).length;

    // Completed today
    const completedToday = await prisma.task.count({
        where: {
            assignments: { some: { userId } },
            status: "DONE",
            doneAt: { gte: today },
        },
    });

    // Completed this week
    const completedThisWeek = await prisma.task.count({
        where: {
            assignments: { some: { userId } },
            status: "DONE",
            doneAt: { gte: weekStart },
        },
    });

    // Get MY projects
    const projects = await prisma.project.findMany({
        where: {
            OR: [
                { ownerId: userId },
                { members: { some: { userId } } },
            ],
            status: { not: "Done" },
        },
        include: {
            tasks: { select: { status: true } },
            owner: true,
        },
        take: 4,
    });

    const projectsWithProgress = projects.map((project) => {
        const totalTasks = project.tasks.filter((t) => t.status !== "CANCELED").length;
        const doneTasks = project.tasks.filter((t) => t.status === "DONE").length;
        const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
        return { ...project, progress, totalTasks, doneTasks };
    });

    // Starred tasks assigned to me
    const starredTasks = await prisma.task.findMany({
        where: {
            assignments: { some: { userId } },
            isStarred: true,
            status: { notIn: ["DONE", "CANCELED"] },
        },
        include: {
            assignments: { include: { user: true } },
            project: true,
        },
        orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
        take: 6,
    });

    // At-risk KPIs (department-wide)
    const kpisAtRisk = await prisma.kPI.findMany({
        where: { status: { in: ["AT_RISK", "OFF_TRACK"] } },
        orderBy: { status: "desc" },
        take: 4,
    });

    // Recent team activity
    const recentActivity = await prisma.auditLog.findMany({
        where: {
            action: { in: ["update", "create"] },
            entityType: "task",
        },
        include: {
            actor: true,
            task: { select: { title: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
    });

    return {
        focusTasks,
        myTasks,
        floatingTasks,
        starredTasks,
        kpisAtRisk,
        urgentCount,
        overdueCount,
        dueTodayCount,
        completedToday,
        completedThisWeek,
        totalMyTasks: myTasks.length,
        projects: projectsWithProgress,
        recentActivity,
    };
}

const signalIcons = {
    urgent: { icon: Zap, tint: "text-orange-500", bg: "bg-orange-500/10" },
    due: { icon: Clock, tint: "text-blue-500", bg: "bg-blue-500/10" },
    overdue: { icon: AlertTriangle, tint: "text-red-500", bg: "bg-red-500/10" },
    done: { icon: CheckCircle2, tint: "text-emerald-500", bg: "bg-emerald-500/10" },
    open: { icon: Target, tint: "text-purple-500", bg: "bg-purple-500/10" },
} as const;

function SignalChip({ kind, value, label }: { kind: keyof typeof signalIcons; value: number; label: string }) {
    const cfg = signalIcons[kind];
    return (
        <div className={cn(
            "flex items-center gap-2.5 rounded-full pl-2 pr-4 py-1.5 ring-1 ring-border/60 bg-card/50 backdrop-blur-sm",
            value > 0 && "ring-transparent",
            value > 0 && cfg.bg,
        )}>
            <span className={cn(
                "flex items-center justify-center h-6 w-6 rounded-full",
                value > 0 ? "bg-background/40" : "bg-muted/40",
            )}>
                <cfg.icon className={cn("h-3.5 w-3.5", value > 0 ? cfg.tint : "text-muted-foreground/40")} />
            </span>
            <span className="text-sm tabular-nums font-semibold">
                <AnimatedNumber value={value} />
            </span>
            <span className="text-xs text-muted-foreground">{label}</span>
        </div>
    );
}

export default async function DashboardPage() {
    const session = await auth();
    if (!session?.user) return null;

    const data = await getDashboardData(session.user.id);
    const dailyTarget = Math.max(data.totalMyTasks, 5);
    const dailyProgress = Math.round((data.completedToday / dailyTarget) * 100);

    return (
        <div className="relative pb-16">
            {/* soft gradient mesh backdrop */}
            <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
                <div className="absolute -top-20 -left-20 h-72 w-72 rounded-full bg-primary/[0.08] blur-3xl" />
                <div className="absolute top-40 right-0 h-96 w-96 rounded-full bg-fuchsia-500/[0.06] blur-3xl" />
                <div className="absolute top-[500px] left-1/3 h-72 w-72 rounded-full bg-blue-500/[0.05] blur-3xl" />
            </div>

            <div className="max-w-6xl mx-auto space-y-8">
                {/* HERO */}
                <StaggerContainer>
                    <StaggerItem>
                        <header className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
                            <div className="space-y-3 min-w-0 flex-1">
                                <WelcomeHeader userName={session.user.name?.split(" ")[0] || "there"} />
                                <div className="flex items-center gap-3 flex-wrap">
                                    <WeatherWidget />
                                </div>
                            </div>
                            <Button asChild size="default" className="shrink-0 shadow-sm">
                                <Link href="/tasks/new">
                                    <Plus className="mr-1.5 h-4 w-4" />
                                    New task
                                </Link>
                            </Button>
                        </header>
                    </StaggerItem>

                    <StaggerItem>
                        <div className="flex items-center gap-2 flex-wrap pt-2">
                            <SignalChip kind="urgent" value={data.urgentCount} label="urgent" />
                            <SignalChip kind="due" value={data.dueTodayCount} label="due today" />
                            <SignalChip kind="overdue" value={data.overdueCount} label="overdue" />
                            <SignalChip kind="open" value={data.totalMyTasks} label="open" />
                            <SignalChip kind="done" value={data.completedToday} label="done today" />
                        </div>
                    </StaggerItem>
                </StaggerContainer>

                {/* MAIN LAYOUT */}
                <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
                    <div className="space-y-6 min-w-0">
                        {data.focusTasks.length > 0 ? (
                            <FocusPanel
                                tasks={data.focusTasks}
                                completedToday={data.completedToday}
                                dailyTarget={dailyTarget}
                            />
                        ) : (
                            <Card className="border-emerald-500/20 bg-emerald-500/[0.03] px-8 py-10 text-center">
                                <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-emerald-500/10 mb-3">
                                    <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                                </div>
                                <div className="text-lg font-semibold mb-1">Nothing urgent right now.</div>
                                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                                    Take a breath, browse the pool, or plan tomorrow.
                                </p>
                                <div className="mt-4 flex justify-center gap-2">
                                    <Button variant="outline" size="sm" asChild>
                                        <Link href="/tasks?tab=pool">Browse pool</Link>
                                    </Button>
                                    <Button size="sm" asChild>
                                        <Link href="/tasks/new">Plan tomorrow</Link>
                                    </Button>
                                </div>
                            </Card>
                        )}

                        <DashboardAnnouncements />

                        {(data.kpisAtRisk.length > 0 || data.floatingTasks.length > 0) && (
                            <div className="grid gap-4 md:grid-cols-2">
                                {data.kpisAtRisk.length > 0 && (
                                    <Card className="border-red-500/25 bg-red-500/[0.03] p-4 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <AlertTriangle className="h-4 w-4 text-red-500" />
                                            <span className="font-semibold text-sm">KPIs at risk</span>
                                            <span className="ml-auto text-[11px] rounded-full bg-red-500/15 text-red-600 dark:text-red-400 px-2 py-0.5 font-medium tabular-nums">
                                                {data.kpisAtRisk.length}
                                            </span>
                                        </div>
                                        <ul className="space-y-1.5">
                                            {data.kpisAtRisk.slice(0, 3).map((k) => (
                                                <li key={k.id}>
                                                    <Link href={`/kpis/${k.id}`} className="text-[13px] hover:text-primary transition-colors line-clamp-1 block">
                                                        {k.name}
                                                    </Link>
                                                </li>
                                            ))}
                                        </ul>
                                    </Card>
                                )}
                                {data.floatingTasks.length > 0 && (
                                    <Card className="border-blue-500/25 bg-blue-500/[0.03] p-4 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <Hand className="h-4 w-4 text-blue-500" />
                                            <span className="font-semibold text-sm">Floating pool</span>
                                            <Link href="/tasks?tab=pool" className="ml-auto text-[11px] rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 px-2 py-0.5 font-medium tabular-nums hover:bg-blue-500/25 transition-colors">
                                                {data.floatingTasks.length}+
                                            </Link>
                                        </div>
                                        <ul className="space-y-1.5">
                                            {data.floatingTasks.slice(0, 3).map((t) => (
                                                <li key={t.id}>
                                                    <Link href={`/tasks/${t.id}`} className="text-[13px] hover:text-primary transition-colors line-clamp-1 block">
                                                        {t.title}
                                                    </Link>
                                                </li>
                                            ))}
                                        </ul>
                                    </Card>
                                )}
                            </div>
                        )}

                        {data.recentActivity.length > 0 && (
                            <Card className="overflow-hidden">
                                <div className="px-5 pt-4 pb-3 flex items-baseline justify-between">
                                    <div className="flex items-center gap-2">
                                        <Users className="h-4 w-4 text-muted-foreground" />
                                        <h2 className="text-base font-semibold tracking-tight">Team pulse</h2>
                                    </div>
                                    <Link href="/team" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                                        All teammates →
                                    </Link>
                                </div>
                                <div className="px-2 pb-2">
                                    <TeamActivity items={JSON.parse(JSON.stringify(data.recentActivity))} />
                                </div>
                            </Card>
                        )}
                    </div>

                    <aside className="space-y-4">
                        <Card variant="elevated" className="overflow-hidden">
                            <div className="p-5">
                                <StreakWidget />
                            </div>
                        </Card>

                        {data.starredTasks.length > 0 && (
                            <Card className="border-amber-400/25 bg-amber-400/[0.04] overflow-hidden">
                                <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                    <span className="text-sm font-semibold">Starred</span>
                                    <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{data.starredTasks.length}</span>
                                </div>
                                <ul className="px-4 pb-3 space-y-1">
                                    {data.starredTasks.slice(0, 3).map((t) => (
                                        <li key={t.id}>
                                            <Link href={`/tasks/${t.id}`} className="text-[13px] hover:text-primary transition-colors line-clamp-1 block">
                                                {t.title}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        )}

                        <div className="px-1">
                            <DailyQuote />
                        </div>

                        <div className="pt-1 space-y-2">
                            <div className="text-[11px] font-medium text-muted-foreground/60 px-1">Shortcuts</div>
                            <div className="grid sm:grid-cols-2 gap-2">
                                <QuickNoteDialog />
                                <Button variant="outline" size="sm" asChild className="justify-start">
                                    <Link href="/tasks?view=board">
                                        <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Kanban
                                    </Link>
                                </Button>
                                <Button variant="outline" size="sm" asChild className="justify-start">
                                    <Link href="/leave/new">Request leave</Link>
                                </Button>
                                <Button variant="outline" size="sm" asChild className="justify-start">
                                    <Link href="/reports">Reports</Link>
                                </Button>
                            </div>
                        </div>

                        <Card className="bg-gradient-to-br from-purple-500/[0.06] to-pink-500/[0.04] border-purple-500/20 p-4 text-center">
                            <div className="text-3xl font-semibold tabular-nums">
                                <AnimatedNumber value={data.completedThisWeek} />
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">completed this week</div>
                        </Card>
                    </aside>
                </div>
            </div>
        </div>
    );
}
