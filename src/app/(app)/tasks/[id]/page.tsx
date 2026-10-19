import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClaimButton } from "@/components/claim-button";
import {
    ArrowLeft,
    Calendar,
    Clock,
    User,
    Link as LinkIcon,
    MessageSquare,
    Tag,
    GitBranch,
    Hand
} from "lucide-react";
import Link from "next/link";
import { formatDate, formatRelativeDate, getInitials, cn, isOverdue } from "@/lib/utils";
import { TaskComments } from "@/components/task-comments";
import { TaskDependencies } from "@/components/task-dependencies";
import { StarTaskButton } from "@/components/star-task-button";
import { InlinePriorityEditor } from "@/components/inline-priority-editor";
import { InlineDueDateEditor } from "@/components/inline-due-date-editor";

import { RequestSupportButton } from "@/components/request-support-button";
import { DeleteButton } from "@/components/delete-button";
import { ActionDetailPanel } from "@/components/pmo/action-detail-panel";
import { PmoBackButton } from "@/components/pmo/pmo-back-button";
import { PmoRouteTracker } from "@/components/pmo/pmo-route-tracker";
import { canManageExternalAction } from "@/lib/pmo/authorization";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";

async function getTask(id: string) {
    const task = await prisma.task.findUnique({
        where: { id },
        include: {
            assignments: { include: { user: true } },
            project: { include: { workArea: true } },
            caseStudy: { include: { workArea: true } },
            kpi: true,
            createdBy: true,
            tags: { include: { tag: true } },
            comments: {
                include: { author: true },
                orderBy: { createdAt: "desc" }
            },
            links: true,
            dependencies: { include: { dependsOn: true } },
            blockers: { include: { task: true } },
            externalAction: { include: { owner: true, externalContact: true, reminderRules: true, evidence: { orderBy: { createdAt: "desc" } }, followUpEvents: { include: { sentBy: true }, orderBy: { createdAt: "desc" } } } },
            auditLogs: { where: { entityType: "external_action", action: "cancel" }, orderBy: { createdAt: "desc" } },
        },
    });

    return task;
}

async function getUsers() {
    return prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });
}

async function getAvailableTasks(excludeId: string) {
    return prisma.task.findMany({
        where: {
            id: { not: excludeId },
            status: { notIn: ["DONE", "CANCELED"] }
        },
        select: { id: true, title: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 50, // Limit to reasonable number
    });
}

const priorityColors: Record<string, string> = {
    URGENT: "priority-urgent",
    HIGH: "priority-high",
    MEDIUM: "priority-medium",
    LOW: "priority-low",
};

const statusColors: Record<string, string> = {
    TODO: "status-todo",
    DOING: "status-doing",
    BLOCKED: "status-blocked",
    WAITING: "status-waiting",
    DONE: "status-done",
    CANCELED: "status-canceled",
};

export default async function TaskDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await auth();
    if (!session?.user) return null;

    const { id } = await params;
    const [task, users, availableTasks] = await Promise.all([
        getTask(id),
        getUsers(),
        getAvailableTasks(id)
    ]);

    if (!task) {
        notFound();
    }

    const overdue = isOverdue(task.dueAt) && !["DONE", "CANCELED"].includes(task.status);
    const isFloating = task.assignments.length === 0;
    const externalAction = task.type === "EXTERNAL_ACTION" ? task.externalAction : null;
    const isPmo = Boolean(externalAction);
    const pmoActor = externalAction ? await getCurrentPmoActor() : null;
    if (externalAction && !pmoActor) return null;
    const canManagePmo = externalAction && pmoActor ? canManageExternalAction(pmoActor, { ownerId: externalAction.ownerId, parentOwnerId: task.project?.ownerId ?? task.caseStudy?.ownerId ?? null, ownerManagerId: externalAction.owner.managerId }) : false;
    const cancellationReason = task.auditLogs.flatMap((entry) => {
        try {
            const metadata = JSON.parse(entry.metaJson ?? "{}") as { reason?: unknown };
            return typeof metadata.reason === "string" ? [metadata.reason] : [];
        } catch {
            return [];
        }
    })[0] ?? null;

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            {isPmo && (
                <Suspense fallback={null}>
                    <PmoRouteTracker kind="external-action" />
                </Suspense>
            )}
            {/* Back button */}
            <div className="mb-6">
                {isPmo ? (
                    <PmoBackButton />
                ) : (
                    <Button variant="ghost" asChild>
                        <Link href="/tasks">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                            Back to Tasks
                        </Link>
                    </Button>
                )}
            </div>

            {/* Header */}
            <div className="mb-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                            <Badge variant="outline" className={cn("text-xs py-0.5", statusColors[task.status])}>
                                {task.status}
                            </Badge>
                            <Badge className={cn("text-xs py-0.5", priorityColors[task.priority])}>
                                {task.priority}
                            </Badge>
                            {isFloating && (
                                <Badge variant="secondary" className="text-xs gap-1 py-0.5">
                                    <Hand className="h-3 w-3" />
                                    Floating
                                </Badge>
                            )}
                            {overdue && (
                                <Badge variant="destructive" className="text-xs py-0.5">
                                    Overdue
                                </Badge>
                            )}
                            {task.project && (
                                <Link href={`/projects/${task.project.id}`} className="text-xs text-muted-foreground hover:text-primary transition-colors underline decoration-dotted">
                                    {task.project.name}
                                </Link>
                            )}
                        </div>
                        <div className="flex items-start gap-2">
                            <StarTaskButton taskId={task.id} isStarred={!!(task as { isStarred?: boolean }).isStarred} size={22} className="mt-1.5" />
                            <h1 className="text-3xl font-bold leading-tight break-words">{task.title}</h1>
                        </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                        {!isPmo && <RequestSupportButton taskId={task.id} />}
                        {(!isPmo || canManagePmo) && <Button variant="outline" size="sm" asChild><Link href={isPmo ? `/pmo/actions/${task.id}/edit` : `/tasks/${task.id}/edit`}>Edit</Link></Button>}
                        {!isPmo && <DeleteButton
                            entityType="task"
                            entityId={task.id}
                            entityName={task.title}
                            redirectUrl="/tasks"
                        />}
                    </div>
                </div>

                {/* Inline editable metadata row */}
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground pl-9">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground/70">Priority</span>
                        <InlinePriorityEditor
                            taskId={task.id}
                            priority={task.priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT"}
                        />
                    </div>
                    <div className="text-muted-foreground/30">·</div>
                    {isPmo ? (
                        <div className="flex items-center gap-1.5 text-xs">
                            <Calendar className="h-3.5 w-3.5" />
                            <span>Due {formatDate(task.dueAt)}</span>
                            {canManagePmo && <Link className="text-primary underline" href={`/pmo/actions/${task.id}/edit`}>Change due date in PMO edit</Link>}
                        </div>
                    ) : <InlineDueDateEditor taskId={task.id} dueAt={task.dueAt} isOverdue={overdue} />}
                    {task.effortHours && (
                        <>
                            <div className="text-muted-foreground/30">·</div>
                            <div className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                <span>{task.effortHours}h estimate</span>
                            </div>
                        </>
                    )}
                    {task.createdBy && (
                        <>
                            <div className="text-muted-foreground/30">·</div>
                            <div className="flex items-center gap-1">
                                <User className="h-3.5 w-3.5" />
                                <span>Created by {task.createdBy.name}</span>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Description */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Description</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {task.description ? (
                                <p className="whitespace-pre-wrap">{task.description}</p>
                            ) : (
                                <p className="text-muted-foreground italic">No description provided</p>
                            )}
                        </CardContent>
                    </Card>

                    {externalAction && <ActionDetailPanel taskId={task.id} status={task.status} canManage={canManagePmo} cancellationReason={cancellationReason} owner={{ name: externalAction.owner.name }} contact={{ name: externalAction.externalContact.name, email: externalAction.externalContact.email, department: externalAction.externalContact.department, organization: externalAction.externalContact.organization }} parentName={task.project?.name ?? task.caseStudy?.name ?? ""} workAreaName={task.project?.workArea?.name ?? task.caseStudy?.workArea?.name ?? "Unclassified"} evidence={externalAction.evidence.map((item) => ({ id: item.id, label: item.label, url: item.url, createdAt: item.createdAt.toISOString() }))} />}

                    {/* Tabs for Comments, Links, Dependencies */}
                    <Tabs defaultValue="comments">
                        <TabsList>
                            <TabsTrigger value="comments" className="gap-2">
                                <MessageSquare className="h-4 w-4" />
                                Comments ({task.comments.length})
                            </TabsTrigger>
                            <TabsTrigger value="links" className="gap-2">
                                <LinkIcon className="h-4 w-4" />
                                Links ({task.links.length})
                            </TabsTrigger>
                            <TabsTrigger value="dependencies" className="gap-2">
                                <GitBranch className="h-4 w-4" />
                                Dependencies
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="comments" className="mt-4">
                            <Card>
                                <CardContent className="pt-6">
                                    <TaskComments
                                        taskId={task.id}
                                        comments={task.comments.map(c => ({
                                            ...c,
                                            createdAt: c.createdAt.toISOString()
                                        }))}
                                        users={users}
                                    />
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="links" className="mt-4">
                            <Card>
                                <CardContent className="pt-6">
                                    {task.links.length === 0 ? (
                                        <p className="text-center text-muted-foreground py-8">No links attached</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {task.links.map((link) => (
                                                <a
                                                    key={link.id}
                                                    href={link.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent"
                                                >
                                                    <LinkIcon className="h-4 w-4 text-muted-foreground" />
                                                    <span className="text-sm text-primary underline">{link.label}</span>
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="dependencies" className="mt-4">
                            <Card>
                                <CardContent className="pt-6">
                                    <TaskDependencies
                                        taskId={task.id}
                                        dependencies={task.dependencies}
                                        blockers={task.blockers}
                                        availableTasks={availableTasks}
                                    />
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    {/* Assignees */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Assignees</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {task.assignments.length === 0 ? (
                                <div className="text-center py-4">
                                    <p className="text-sm text-muted-foreground mb-3">No assignees</p>
                                    {!isPmo && <ClaimButton taskId={task.id} />}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {task.assignments.map((assignment) => (
                                        <div key={assignment.id} className="flex items-center gap-3">
                                            <Avatar className="h-8 w-8">
                                                <AvatarImage src={assignment.user.image || ""} />
                                                <AvatarFallback className="text-xs">
                                                    {getInitials(assignment.user.name)}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="text-sm font-medium">{assignment.user.name}</p>
                                                <p className="text-xs text-muted-foreground">{assignment.user.email}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Tags */}
                    {task.tags.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Tags</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="flex flex-wrap gap-2">
                                    {task.tags.map((tt) => (
                                        <Badge
                                            key={tt.id}
                                            variant="secondary"
                                            style={{ backgroundColor: tt.tag.color + "20", color: tt.tag.color }}
                                        >
                                            <Tag className="h-3 w-3 mr-1" />
                                            {tt.tag.name}
                                        </Badge>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Related */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Related</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {task.project && (
                                <Link
                                    href={`/projects/${task.project.id}`}
                                    className="block text-sm hover:underline"
                                >
                                    <span className="text-muted-foreground">Project: </span>
                                    <span className="text-primary">{task.project.name}</span>
                                </Link>
                            )}
                            {task.caseStudy && (
                                <Link
                                    href={`/case-studies/${task.caseStudy.id}`}
                                    className="block text-sm hover:underline"
                                >
                                    <span className="text-muted-foreground">Case Study: </span>
                                    <span className="text-primary">{task.caseStudy.name}</span>
                                </Link>
                            )}
                            {task.kpi && (
                                <Link
                                    href={`/kpis/${task.kpi.id}`}
                                    className="block text-sm hover:underline"
                                >
                                    <span className="text-muted-foreground">KPI: </span>
                                    <span className="text-primary">{task.kpi.name}</span>
                                </Link>
                            )}
                            {!task.project && !task.caseStudy && !task.kpi && (
                                <p className="text-sm text-muted-foreground">No relationships</p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Metadata */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Details</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm space-y-2">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Created</span>
                                <span>{formatDate(task.createdAt)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Updated</span>
                                <span>{formatDate(task.updatedAt)}</span>
                            </div>
                            {task.startAt && (
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Start Date</span>
                                    <span>{formatDate(task.startAt)}</span>
                                </div>
                            )}
                            {task.doneAt && (
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Completed</span>
                                    <span>{formatDate(task.doneAt)}</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div >
        </div >
    );
}
