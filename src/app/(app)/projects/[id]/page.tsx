import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectGantt } from "@/components/project-gantt";
import { ProjectReport } from "@/components/project-report";
import { ProjectPipelineTab } from "@/components/projects/project-pipeline-tab";
import { ProjectTrend } from "@/components/projects/project-trend";
import { ProjectBriefButton } from "@/components/projects/project-brief-button";
import { PrintButton } from "@/components/print-button";
import { DeleteButton } from "@/components/delete-button";
import { RequestSupportButton } from "@/components/request-support-button";
import { ProjectTaskItem } from "@/components/project-task-item";
import {
    ArrowLeft,
    Calendar,
    CheckCircle2,
    Clock,
    Plus,
    Download,
    AlertTriangle,
    AlertCircle,
    Archive,
    TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { formatDate, getInitials, cn, isOverdue } from "@/lib/utils";
import { projectHealth, healthMeta, type ProjectHealth } from "@/lib/project-health";
import { saudiWeekStart } from "@/lib/team-load";
import { ParentWorkAreaPicker } from "@/components/pmo/parent-work-area-picker";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { ExternalActionsList } from "@/components/pmo/external-actions-list";
import { getDueBucket, toRiyadhDate } from "@/lib/pmo/date";
import { deriveImplementationDuration } from "@/lib/projects/duration";

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
        <Badge className={cn("gap-1", meta.className)}>
            <Icon className="h-3 w-3" />
            {meta.label}
        </Badge>
    );
}

/** Tasks completed per Saudi work-week for the last 6 weeks (oldest first). */
function momentumBuckets(tasks: { doneAt: Date | null; status: string }[]): { label: string; done: number }[] {
    const now = new Date();
    const thisWeekStart = saudiWeekStart(now);
    const buckets: { label: string; start: Date; end: Date; done: number }[] = [];
    for (let i = 5; i >= 0; i--) {
        const start = new Date(thisWeekStart);
        start.setUTCDate(start.getUTCDate() - i * 7);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 7);
        const label = start.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
        buckets.push({ label, start, end, done: 0 });
    }
    for (const t of tasks) {
        if (t.status !== "DONE" || !t.doneAt) continue;
        const d = new Date(t.doneAt);
        const b = buckets.find((bk) => d >= bk.start && d < bk.end);
        if (b) b.done++;
    }
    return buckets.map((b) => ({ label: b.label, done: b.done }));
}

async function getProject(id: string) {
    const project = await prisma.project.findUnique({
        where: { id },
        include: {
            owner: true,
            manager: true,
            sponsor: true,
            responsibleDepartment: true,
            workArea: true,
            members: { include: { user: true } },
            stages: { orderBy: { order: "asc" } },
            objectives: { orderBy: { order: "asc" } },
            outputs: { orderBy: { order: "asc" } },
            risks: { orderBy: { createdAt: "asc" } },
            tasks: {
                include: {
                    assignments: { include: { user: true } },
                    tags: { include: { tag: true } },
                    externalAction: { include: { owner: true, externalContact: true, evidence: true, followUpEvents: { where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" }, take: 1 } } },
                },
                orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
            },
        },
    });

    return project;
}

const statusColors: Record<string, string> = {
    Active: "bg-green-500/10 text-green-600",
    "On Hold": "bg-yellow-500/10 text-yellow-600",
    Done: "bg-blue-500/10 text-blue-600",
    Archived: "bg-gray-500/10 text-gray-600",
};

const priorityColors: Record<string, string> = {
    URGENT: "priority-urgent",
    HIGH: "priority-high",
    MEDIUM: "priority-medium",
    LOW: "priority-low",
};

export default async function ProjectDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await auth();
    if (!session?.user) return null;

    const { id } = await params;
    const project = await getProject(id);
    const workAreas = await prisma.workArea.findMany({ where: { isArchived: false }, select: { id: true, name: true }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });

    if (!project) {
        notFound();
    }

    const now = new Date();
    const ordinaryTasks = project.tasks.filter((task) => task.type === "STANDARD");
    const externalTasks = project.tasks.filter((task) => task.type === "EXTERNAL_ACTION" && task.externalAction && task.dueAt);
    const totalTasks = ordinaryTasks.filter((t) => t.status !== "CANCELED").length;
    const doneTasks = ordinaryTasks.filter((t) => t.status === "DONE").length;
    const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    const openTasks = ordinaryTasks.filter((t) => !["DONE", "CANCELED"].includes(t.status));
    const overdueOpen = openTasks.filter((t) => t.dueAt && new Date(t.dueAt) < now);
    const isOwner = project.ownerId === session.user.id;
    const pmoActor = await getCurrentPmoActor();

    const health = projectHealth({
        status: project.status,
        dueAt: project.dueAt,
        progress,
        overdueOpenTasks: overdueOpen.length,
        now,
    });

    const momentum = momentumBuckets(ordinaryTasks);

    // Open task count per person (owner + members), so it's visible who carries what.
    const openByUser = new Map<string, number>();
    for (const t of openTasks) {
        for (const a of t.assignments) {
            openByUser.set(a.user.id, (openByUser.get(a.user.id) ?? 0) + 1);
        }
    }

    return (
        <div className="max-w-6xl mx-auto animate-fade-in">
            <div className="mb-6 flex items-center justify-between">
                <Button variant="ghost" asChild>
                    <Link href="/projects">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Projects
                    </Link>
                </Button>
                <div className="flex gap-2">
                    <RequestSupportButton projectId={project.id} />
                    <Button variant="outline" asChild>
                        <Link href={`/api/projects/${project.id}/export`} download>
                            <Download className="mr-2 h-4 w-4" />
                            Export to Excel
                        </Link>
                    </Button>
                    <PrintButton />
                    <Button variant="outline" asChild>
                        <Link href={`/projects/${project.id}/roadmap`}>Roadmap</Link>
                    </Button>
                    <Button asChild>
                        <Link href={`/projects/${project.id}/edit`}>Edit Project</Link>
                    </Button>
                    <DeleteButton
                        entityType="project"
                        entityId={project.id}
                        entityName={project.name}
                        redirectUrl="/projects"
                    />
                </div>
            </div>

            {/* Header */}
            <div className="mb-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <Badge className={statusColors[project.status] || ""}>
                                {project.status}
                            </Badge>
                            <HealthBadge health={health} />
                        </div>
                        <h1 className="text-3xl font-bold" dir="auto">{project.name}</h1>
                        <div className="mt-3" aria-label="PMO work area"><ParentWorkAreaPicker parentType="project" parentId={project.id} currentWorkAreaId={project.workAreaId} expectedUpdatedAt={new Date(project.updatedAt).toISOString()} workAreas={workAreas} canEditParent={Boolean(pmoActor && (project.ownerId === pmoActor.id || pmoActor.role === "ADMIN"))} /></div>
                        {project.description && (
                            <p className="text-muted-foreground mt-2">{project.description}</p>
                        )}
                    </div>
                </div>

                {/* Progress */}
                <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium">{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-3" />
                    <p className="text-sm text-muted-foreground">
                        {doneTasks} of {totalTasks} tasks completed
                    </p>
                </div>

                {/* Quick Info */}
                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    {project.startAt && (
                        <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>Started {formatDate(project.startAt)}</span>
                        </div>
                    )}
                    {project.dueAt && (
                        <div className={cn("flex items-center gap-1", isOverdue(project.dueAt) && "text-red-500")}>
                            <Clock className="h-4 w-4" />
                            <span>Due {formatDate(project.dueAt)}</span>
                        </div>
                    )}
                </div>
            </div>

                <Card className="mb-6"><CardHeader><CardTitle>Strategic summary</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><div><strong>Responsible administration</strong><p>{project.responsibleDepartment?.name ?? "Not assigned"}</p></div><div><strong>Project manager</strong><p>{project.manager?.name ?? "Not assigned"}</p></div><div><strong>Sponsor</strong><p>{project.sponsor?.name ?? "Not assigned"} ({project.sponsorStatus})</p></div><div><strong>Priority / health</strong><p>{project.priority} / {project.health}</p></div><div className="md:col-span-2"><strong>Objective</strong><p>{project.objective || "Not provided"}</p></div><div><strong>Scope</strong><p>{project.scope || "Not provided"}</p></div><div><strong>Success criteria</strong><p>{project.successCriteria || "Not provided"}</p></div><div><strong>Implementation duration</strong><p>{project.startAt && project.dueAt ? deriveImplementationDuration(new Date(project.startAt).toISOString().slice(0, 10), new Date(project.dueAt).toISOString().slice(0, 10)).label : "Not available"}</p></div><div><strong>Objectives</strong><ul className="list-disc pl-5">{project.objectives.map((item: { id: string; statement: string }) => <li key={item.id}>{item.statement}</li>)}</ul></div><div><strong>Outputs</strong><ul className="list-disc pl-5">{project.outputs.map((item: { id: string; title: string }) => <li key={item.id}>{item.title}</li>)}</ul></div><div><strong>Risks</strong><ul className="list-disc pl-5">{project.risks.map((item: { id: string; title: string; status: string }) => <li key={item.id}>{item.title} ({item.status})</li>)}</ul></div><div><strong>Stages</strong><ul className="list-disc pl-5">{project.stages.map((item: { id: string; name: string; status: string }) => <li key={item.id}>{item.name} ({item.status})</li>)}</ul></div></CardContent></Card>

            <Tabs defaultValue="overview" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
                    <TabsTrigger value="gantt">Gantt Chart</TabsTrigger>
                    <TabsTrigger value="report">Report</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-6">
                    {overdueOpen.length > 0 && (
                        <Card className="border-red-500/50">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-base text-red-600 dark:text-red-400">
                                    <AlertTriangle className="h-4 w-4" />
                                    {overdueOpen.length} overdue task{overdueOpen.length === 1 ? "" : "s"}
                                </CardTitle>
                                <CardDescription>Past their due date and still open.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-1.5">
                                    {overdueOpen.slice(0, 3).map((t) => (
                                        <Link
                                            key={t.id}
                                            href={`/tasks/${t.id}`}
                                            className="flex items-center justify-between gap-2 text-sm hover:text-primary transition-colors"
                                        >
                                            <span className="truncate" dir="auto">{t.title}</span>
                                            {t.dueAt && (
                                                <span className="shrink-0 text-xs text-red-500">Due {formatDate(t.dueAt)}</span>
                                            )}
                                        </Link>
                                    ))}
                                    {overdueOpen.length > 3 && (
                                        <p className="text-xs text-muted-foreground">+{overdueOpen.length - 3} more overdue</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                    <div className="grid gap-6 lg:grid-cols-3">
                        {/* Tasks */}
                        <div className="lg:col-span-2">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <div>
                                        <CardTitle>Tasks</CardTitle>
                                        <CardDescription>{openTasks.length} open tasks</CardDescription>
                                    </div>
                                    <div className="flex gap-2"><Button size="sm" variant="outline" asChild><Link href={`/pmo/actions/new?projectId=${project.id}`}>Add external action</Link></Button><Button size="sm" asChild><Link href="/tasks/new"><Plus className="mr-2 h-4 w-4" />Add Task</Link></Button></div>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {ordinaryTasks.length === 0 ? (
                                            <p className="text-center text-muted-foreground py-8">No tasks yet</p>
                                        ) : (
                                            ordinaryTasks.map((task) => (
                                                <ProjectTaskItem
                                                    key={task.id}
                                                    task={task}
                                                    isOwner={isOwner}
                                                />
                                            ))
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="mt-6"><CardHeader><CardTitle>External Actions</CardTitle><CardDescription>{externalTasks.length} PMO follow-ups</CardDescription></CardHeader><CardContent><ExternalActionsList actions={externalTasks.map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, dueDate: toRiyadhDate(task.dueAt!), dueBucket: getDueBucket(toRiyadhDate(task.dueAt!), task.status, toRiyadhDate(now)), ownerName: task.externalAction!.owner.name, contactName: task.externalAction!.externalContact.name, department: task.externalAction!.externalContact.department, parentName: project.name, workAreaName: project.workArea?.name ?? "Unclassified", evidenceCount: task.externalAction!.evidence.length, lastSentAt: task.externalAction!.followUpEvents[0]?.sentAt?.toISOString() ?? null }))} /></CardContent></Card>
                        </div>

                        {/* Sidebar */}
                        <div className="space-y-6">
                            {/* Team */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">Team</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {project.owner && (
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-8 w-8">
                                                    <AvatarImage src={project.owner.image || ""} />
                                                    <AvatarFallback className="text-xs">{getInitials(project.owner.name)}</AvatarFallback>
                                                </Avatar>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium truncate" dir="auto">{project.owner.name}</p>
                                                    <p className="text-xs text-muted-foreground">Owner</p>
                                                </div>
                                                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                                    {openByUser.get(project.owner.id) ?? 0} open
                                                </span>
                                            </div>
                                        )}
                                        {project.members.map((member) => (
                                            <div key={member.id} className="flex items-center gap-3">
                                                <Avatar className="h-8 w-8">
                                                    <AvatarImage src={member.user.image || ""} />
                                                    <AvatarFallback className="text-xs">{getInitials(member.user.name)}</AvatarFallback>
                                                </Avatar>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium truncate" dir="auto">{member.user.name}</p>
                                                    <p className="text-xs text-muted-foreground">Member</p>
                                                </div>
                                                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                                    {openByUser.get(member.user.id) ?? 0} open
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Details */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">Details</CardTitle>
                                </CardHeader>
                                <CardContent className="text-sm space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Created</span>
                                        <span>{formatDate(project.createdAt)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Updated</span>
                                        <span>{formatDate(project.updatedAt)}</span>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Momentum */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                                        Momentum
                                    </CardTitle>
                                    <CardDescription>Tasks completed per week</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {momentum.some((b) => b.done > 0) ? (
                                        <ProjectTrend weeks={momentum} />
                                    ) : (
                                        <p className="text-sm italic text-muted-foreground">
                                            No tasks completed in the last 6 weeks yet.
                                        </p>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="pipeline">
                    <ProjectPipelineTab
                        projectId={project.id}
                        stages={project.stages}
                        tasks={project.tasks.map((t) => ({
                            id: t.id,
                            title: t.title,
                            description: t.description,
                            status: t.status,
                            priority: t.priority,
                            dueAt: t.dueAt,
                            stageId: t.stageId,
                            project: null,
                            assignments: t.assignments,
                            tags: t.tags,
                        }))}
                    />
                </TabsContent>

                <TabsContent value="gantt">
                    <ProjectGantt
                        tasks={project.tasks.map(t => ({ ...t, startAt: t.startAt ? t.startAt.toISOString() : null, dueAt: t.dueAt ? t.dueAt.toISOString() : null, createdAt: t.createdAt.toISOString() }))}
                        startDate={project.startAt ? project.startAt.toISOString() : null}
                        dueDate={project.dueAt ? project.dueAt.toISOString() : null}
                    />
                </TabsContent>

                <TabsContent value="report" className="space-y-4">
                    <div className="flex justify-end">
                        <ProjectBriefButton projectId={project.id} projectName={project.name} />
                    </div>
                    <ProjectReport tasks={project.tasks} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
