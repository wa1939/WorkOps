import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import {
    Plus,
    FolderKanban,
    Calendar,
    Users,
    Hand,
    Clock,
    ListTodo,
    AlertTriangle,
    TrendingUp,
    CheckCircle2,
    AlertCircle,
    Archive,
} from "lucide-react";
import Link from "next/link";
import { formatDate, getInitials, cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { projectHealth, healthMeta, type ProjectHealth } from "@/lib/project-health";

const STATUS_FILTERS = ["Active", "On Hold", "Done", "Archived"] as const;

function healthIcon(h: ProjectHealth) {
    if (h === "ON_TRACK") return CheckCircle2;
    if (h === "AT_RISK") return AlertTriangle;
    if (h === "OFF_TRACK") return AlertCircle;
    return Archive;
}

function HealthBadge({ health }: { health: ProjectHealth }) {
    const meta = healthMeta(health);
    const Icon = healthIcon(health);
    return (
        <Badge className={cn("gap-1 shrink-0", meta.className)}>
            <Icon className="h-3 w-3" />
            {meta.label}
        </Badge>
    );
}

async function getProjects(opts: { floating?: boolean; status?: string }) {
    const where: Record<string, unknown> = {};
    if (opts.floating) where.ownerId = null;
    if (opts.status) where.status = opts.status;

    const now = new Date();
    const projects = await prisma.project.findMany({
        where,
        include: {
            owner: true,
            members: { include: { user: true } },
            tasks: { select: { status: true, dueAt: true, title: true } },
        },
        orderBy: { updatedAt: "desc" },
    });

    return projects.map((project) => {
        const active = project.tasks.filter((t) => t.status !== "CANCELED");
        const totalTasks = active.length;
        const doneTasks = active.filter((t) => t.status === "DONE").length;
        const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
        const openList = project.tasks.filter((t) => !["DONE", "CANCELED"].includes(t.status));
        const overdueOpenTasks = openList.filter((t) => t.dueAt && new Date(t.dueAt) < now).length;
        const nextDue =
            openList
                .filter((t) => t.dueAt)
                .sort((a, b) => new Date(a.dueAt as Date).getTime() - new Date(b.dueAt as Date).getTime())[0] ?? null;
        const health = projectHealth({ status: project.status, dueAt: project.dueAt, progress, overdueOpenTasks, now });

        return {
            ...project,
            progress,
            totalTasks,
            doneTasks,
            openTasks: openList.length,
            overdueOpenTasks,
            nextDue: nextDue ? { title: nextDue.title, dueAt: nextDue.dueAt as Date } : null,
            health,
        };
    });
}

async function getPortfolioMetrics() {
    const now = new Date();
    const projects = await prisma.project.findMany({
        select: { status: true, tasks: { select: { status: true, dueAt: true } } },
    });

    let activeCount = 0;
    let progressSum = 0;
    let progressN = 0;
    let openSum = 0;
    let overdueSum = 0;

    for (const p of projects) {
        const active = p.tasks.filter((t) => t.status !== "CANCELED");
        const done = active.filter((t) => t.status === "DONE").length;
        const progress = active.length ? Math.round((done / active.length) * 100) : 0;
        const openList = p.tasks.filter((t) => !["DONE", "CANCELED"].includes(t.status));

        if (p.status === "Active") activeCount++;
        if (p.status !== "Done" && p.status !== "Archived") {
            progressSum += progress;
            progressN++;
        }
        openSum += openList.length;
        overdueSum += openList.filter((t) => t.dueAt && new Date(t.dueAt) < now).length;
    }

    return {
        activeCount,
        avgProgress: progressN ? Math.round(progressSum / progressN) : 0,
        openSum,
        overdueSum,
    };
}

const statusColors: Record<string, string> = {
    Active: "bg-green-500/10 text-green-600",
    "On Hold": "bg-yellow-500/10 text-yellow-600",
    Done: "bg-blue-500/10 text-blue-600",
    Archived: "bg-gray-500/10 text-gray-600",
};

export default async function ProjectsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | undefined>>;
}) {
    const session = await auth();
    if (!session?.user) return null;

    const resolvedParams = await searchParams;
    const floating = resolvedParams.floating === "true";
    const activeStatus = STATUS_FILTERS.includes(resolvedParams.status as (typeof STATUS_FILTERS)[number])
        ? resolvedParams.status
        : undefined;

    const [projects, metrics] = await Promise.all([
        getProjects({ floating, status: activeStatus }),
        getPortfolioMetrics(),
    ]);

    const noFilter = !floating && !activeStatus;

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" dir="auto">
                        {floating ? "Unassigned Projects" : "Projects"}
                    </h1>
                    <p className="text-sm text-muted-foreground">Track progress, health, and what&apos;s due across the portfolio</p>
                </div>
                <Button asChild className="max-sm:w-full">
                    <Link href="/projects/new">
                        <Plus className="mr-2 h-4 w-4" />
                        New Project
                    </Link>
                </Button>
            </div>

            {/* Portfolio metrics — swipeable rail on phones, grid on larger screens */}
            <div className="scroll-touch edge-fade -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 lg:grid-cols-4">
                <Card className="min-w-[150px] shrink-0 md:min-w-0">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Active</CardTitle>
                        <FolderKanban className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums">{metrics.activeCount}</div>
                        <p className="text-xs text-muted-foreground">in progress now</p>
                    </CardContent>
                </Card>
                <Card className="min-w-[150px] shrink-0 md:min-w-0">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Avg Progress</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums">{metrics.avgProgress}%</div>
                        <p className="text-xs text-muted-foreground">across open projects</p>
                    </CardContent>
                </Card>
                <Card className="min-w-[150px] shrink-0 md:min-w-0">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Open Tasks</CardTitle>
                        <ListTodo className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tabular-nums">{metrics.openSum}</div>
                        <p className="text-xs text-muted-foreground">across all projects</p>
                    </CardContent>
                </Card>
                <Card className={cn("min-w-[150px] shrink-0 md:min-w-0", metrics.overdueSum > 0 && "border-red-500/50")}>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Overdue</CardTitle>
                        <AlertTriangle className={cn("h-4 w-4", metrics.overdueSum > 0 ? "text-red-500" : "text-muted-foreground")} />
                    </CardHeader>
                    <CardContent>
                        <div className={cn("text-2xl font-bold tabular-nums", metrics.overdueSum > 0 && "text-red-500")}>
                            {metrics.overdueSum}
                        </div>
                        <p className="text-xs text-muted-foreground">need attention</p>
                    </CardContent>
                </Card>
            </div>

            {/* Filters — horizontally swipeable pill rail on phones */}
            <div className="scroll-touch edge-fade -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
                <Button variant={noFilter ? "default" : "outline"} size="sm" className="shrink-0" asChild>
                    <Link href="/projects">All</Link>
                </Button>
                {STATUS_FILTERS.map((s) => (
                    <Button key={s} variant={activeStatus === s ? "default" : "outline"} size="sm" className="shrink-0" asChild>
                        <Link href={`/projects?status=${encodeURIComponent(s)}`}>{s}</Link>
                    </Button>
                ))}
                <Button variant={floating ? "default" : "outline"} size="sm" className="shrink-0" asChild>
                    <Link href="/projects?floating=true">
                        <Hand className="mr-2 h-4 w-4" />
                        Unassigned
                    </Link>
                </Button>
            </div>

            {projects.length === 0 ? (
                noFilter ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center py-16">
                            <FolderKanban className="h-12 w-12 text-muted-foreground mb-4" />
                            <p className="text-muted-foreground mb-4">No projects yet</p>
                            <Button asChild>
                                <Link href="/projects/new">
                                    <Plus className="mr-2 h-4 w-4" />
                                    Create Project
                                </Link>
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <EmptyState
                        icon={FolderKanban}
                        title={`No ${floating ? "unassigned" : activeStatus} projects`}
                        description="Nothing matches this filter right now."
                        actions={[{ label: "Show all projects", href: "/projects", icon: FolderKanban, variant: "primary" }]}
                    />
                )
            ) : (
                <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {projects.map((project) => (
                        <Link key={project.id} href={`/projects/${project.id}`} className="card-press block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                            <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer">
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <CardTitle className="text-base leading-snug sm:text-lg" dir="auto">
                                            {project.name}
                                        </CardTitle>
                                        <Badge className={cn("shrink-0", statusColors[project.status] || "")}>
                                            {project.status}
                                        </Badge>
                                    </div>
                                    <div className="pt-1">
                                        <HealthBadge health={project.health} />
                                    </div>
                                    {project.description && (
                                        <CardDescription className="line-clamp-2" dir="auto">
                                            {project.description}
                                        </CardDescription>
                                    )}
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Progress</span>
                                            <span className="font-medium tabular-nums">{project.progress}%</span>
                                        </div>
                                        <Progress value={project.progress} className="h-2" />
                                        <p className="text-xs text-muted-foreground">
                                            <span className="nums">{project.doneTasks} of {project.totalTasks}</span> tasks completed
                                            {project.overdueOpenTasks > 0 && (
                                                <span className="text-red-500"> · <span className="nums">{project.overdueOpenTasks}</span> overdue</span>
                                            )}
                                        </p>
                                    </div>

                                    {project.nextDue && (
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <Clock className="h-3.5 w-3.5 shrink-0" />
                                            <span className="min-w-0 truncate" dir="auto">
                                                Next due: {project.nextDue.title}
                                            </span>
                                            <span className="shrink-0 nums">· {formatDate(project.nextDue.dueAt)}</span>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between gap-2 text-sm">
                                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                                            Updated {formatDistanceToNow(project.updatedAt, { addSuffix: true })}
                                        </span>
                                        <div className="flex -space-x-2">
                                            {project.owner && (
                                                <Avatar className="h-6 w-6 border-2 border-background">
                                                    <AvatarImage src={project.owner.image || ""} />
                                                    <AvatarFallback className="text-xs">{getInitials(project.owner.name)}</AvatarFallback>
                                                </Avatar>
                                            )}
                                            {project.members.slice(0, 3).map((m) => (
                                                <Avatar key={m.id} className="h-6 w-6 border-2 border-background">
                                                    <AvatarImage src={m.user.image || ""} />
                                                    <AvatarFallback className="text-xs">{getInitials(m.user.name)}</AvatarFallback>
                                                </Avatar>
                                            ))}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
