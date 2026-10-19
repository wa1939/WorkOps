import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Plus,
    User,
    Users,
    CheckCircle2,
    LayoutGrid,
    List,
    Hand,
    RotateCcw,
    Calendar,
    Flame,
    HelpCircle,
    Lock,
    Eye,
    Search,
    Download
} from "lucide-react";
import Link from "next/link";
import { formatRelativeDate, getInitials, cn, isOverdue } from "@/lib/utils";
import { KanbanBoard } from "@/components/kanban-board";
import { ClaimTaskButton } from "@/components/claim-task-button";
import { MarkDoneButton } from "@/components/mark-done-button";
import { OfferHelpButton } from "@/components/offer-help-button";
import { StarTaskButton } from "@/components/star-task-button";
import { TaskRowMenu } from "@/components/task-row-menu";
import { InlinePriorityEditor } from "@/components/inline-priority-editor";
import { InlineDueDateEditor } from "@/components/inline-due-date-editor";
import { CommentCountChip } from "@/components/comment-count-chip";
import { TableCellAssist } from "@/components/sabah/forms/table-cell-assist";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskViewSwitcher } from "@/components/tasks/TaskViewSwitcher";
import { dueWindowFilter, parseDueWindow, parsePriority, parseTaskSort, taskOrderBy } from "@/lib/task-query";
import type { Prisma } from "@prisma/client";

async function getTasksData(
    userId: string,
    tab: string,
    search?: string,
    memberId?: string,
    priority?: string,
    due?: string,
    sort?: string,
) {
    const dueWindow = parseDueWindow(due);
    const orderBy = taskOrderBy(parseTaskSort(sort));

    const baseWhere: Prisma.TaskWhereInput = {
        ...dueWindowFilter(dueWindow),
    };

    if (search) {
        baseWhere.OR = [
            { title: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
        ];
    }

    const parsedPriority = parsePriority(priority);
    if (parsedPriority) {
        baseWhere.priority = parsedPriority;
    }

    // My Tasks
    const myTasks = await prisma.task.findMany({
        where: {
            ...baseWhere,
            assignments: { some: { userId } },
            status: { notIn: ["DONE", "CANCELED"] },
        },
        include: {
            assignments: { include: { user: true } },
            project: true,
            tags: { include: { tag: true } },
            supportRequests: { where: { status: "Open" } },
            _count: { select: { comments: true } },
        },
        orderBy,
    });

    // Team Pool (floating)
    const teamPool = await prisma.task.findMany({
        where: {
            ...baseWhere,
            assignments: { none: {} },
            status: { notIn: ["DONE", "CANCELED"] },
        },
        include: {
            assignments: { include: { user: true } },
            project: true,
            tags: { include: { tag: true } },
            supportRequests: { where: { status: "Open" } },
            _count: { select: { comments: true } },
        },
        orderBy,
    });

    // Team Members Tasks (excluding my own)
    const teamTasks = await prisma.task.findMany({
        where: {
            ...baseWhere,
            AND: [
                { assignments: { some: {} } },
                { NOT: { assignments: { some: { userId } } } },
            ],
            status: { notIn: ["DONE", "CANCELED"] },
        },
        include: {
            assignments: { include: { user: true } },
            project: true,
            tags: { include: { tag: true } },
            supportRequests: { where: { status: "Open" } },
            _count: { select: { comments: true } },
        },
        orderBy,
    });

    // Get all team members with their task counts
    const allUsers = await prisma.user.findMany({
        where: { id: { not: userId } },
        include: {
            taskAssignments: {
                where: {
                    task: {
                        status: { notIn: ["DONE", "CANCELED"] },
                    },
                },
                include: { task: true },
            },
        },
    });

    const teamMembers = allUsers.map(user => ({
        id: user.id,
        name: user.name,
        image: user.image,
        taskCount: user.taskAssignments.length,
        urgentCount: user.taskAssignments.filter(a => a.task.priority === "URGENT").length,
        overdueCount: user.taskAssignments.filter(a => a.task.dueAt && new Date(a.task.dueAt) < new Date()).length,
    })).filter(m => m.taskCount > 0).sort((a, b) => b.taskCount - a.taskCount);

    // Filter team tasks by member if specified
    const filteredTeamTasks = memberId
        ? teamTasks.filter(t => t.assignments.some(a => a.userId === memberId))
        : teamTasks;

    // Completed
    const completed = await prisma.task.findMany({
        where: {
            ...baseWhere,
            status: "DONE",
            assignments: { some: { userId } },
        },
        include: {
            assignments: { include: { user: true } },
            project: true,
            tags: { include: { tag: true } },
            supportRequests: { where: { status: "Open" } },
            _count: { select: { comments: true } },
        },
        // Completed work reads best most-recently-finished-first unless a sort is chosen.
        orderBy: sort ? orderBy : { doneAt: "desc" },
        take: 50,
    });

    // Need Support
    const needSupportTasks = await prisma.task.findMany({
        where: {
            supportRequests: { some: { status: "Open" } },
            status: { notIn: ["DONE", "CANCELED"] },
        },
        include: {
            assignments: { include: { user: true } },
            project: true,
            tags: { include: { tag: true } },
            supportRequests: { where: { status: "Open" } },
            _count: { select: { comments: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
    });

    // Get current tab's tasks for Kanban view
    const kanbanTasks = tab === "pool" ? teamPool : myTasks;
    const tasksByStatus = {
        TODO: kanbanTasks.filter((t) => t.status === "TODO"),
        DOING: kanbanTasks.filter((t) => t.status === "DOING"),
        BLOCKED: kanbanTasks.filter((t) => t.status === "BLOCKED"),
        WAITING: kanbanTasks.filter((t) => t.status === "WAITING"),
        DONE: kanbanTasks.filter((t) => t.status === "DONE"),
    };

    return {
        myTasks,
        teamPool,
        teamTasks: filteredTeamTasks,
        teamMembers,
        completed,
        needSupportTasks,
        tasksByStatus,
        counts: {
            my: myTasks.length,
            pool: teamPool.length,
            team: teamTasks.length,
            completed: completed.length,
            support: needSupportTasks.length,
        },
    };
}

const priorityConfig: Record<string, { color: string; icon: React.ReactNode }> = {
    URGENT: { color: "bg-red-500", icon: <Flame className="h-3 w-3" /> },
    HIGH: { color: "bg-orange-500", icon: null },
    MEDIUM: { color: "bg-blue-500", icon: null },
    LOW: { color: "bg-slate-400", icon: null },
};

function TaskRow({
    task,
    showClaim = false,
    showUndo = false,
    showHelp = false,
    userId
}: {
    task: Awaited<ReturnType<typeof getTasksData>>["myTasks"][0];
    showClaim?: boolean;
    showUndo?: boolean;
    showHelp?: boolean;
    userId: string;
}) {
    const isAssignedToMe = task.assignments.some(a => a.userId === userId);
    const dueDate = task.dueAt ? new Date(task.dueAt) : null;
    const overdue = dueDate && isOverdue(dueDate);
    const hasOpenSupport = (task as { supportRequests?: unknown[] }).supportRequests?.length ?? 0 > 0;

    return (
        <Link href={`/tasks/${task.id}`} className="block">
            <div className={cn(
                "flex items-center gap-3 py-2.5 pl-3 pr-4 rounded-lg border bg-card hover:bg-accent/40 transition-colors duration-150 group",
                "max-sm:flex-wrap max-sm:py-3",
                overdue && "border-red-500/20",
                hasOpenSupport && "border-yellow-500/25 bg-yellow-500/5",
                (task as { isStarred?: boolean }).isStarred && "border-amber-400/30"
            )}>
                {/* Priority Indicator — click to edit */}
                <div data-sabah-entity-id={task.id} className="contents">
                <InlinePriorityEditor taskId={task.id} priority={task.priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT"} />
                <TableCellAssist entityId={task.id} columnKey="priority" />

                {/* Star */}
                <StarTaskButton taskId={task.id} isStarred={!!(task as { isStarred?: boolean }).isStarred} />

                {/* Main Content — spans full width on phones below the star */}
                <div className="flex-1 min-w-0 max-sm:basis-full max-sm:order-first max-sm:w-full">
                    <div className="flex items-center gap-2 mb-1">
                        <span dir="auto" className={cn(
                            "font-medium truncate min-w-0",
                            "max-sm:whitespace-normal max-sm:line-clamp-2",
                            task.status === "DONE" && "line-through text-muted-foreground"
                        )}>
                            {task.title}
                        </span>
                        {task.priority === "URGENT" && (
                            <Badge variant="destructive" className="text-xs py-0 shrink-0">URGENT</Badge>
                        )}
                        {hasOpenSupport && (
                            <Badge variant="outline" className="text-xs py-0 border-yellow-500 text-yellow-600 shrink-0">
                                <HelpCircle className="h-3 w-3 mr-1" />
                                Needs Help
                            </Badge>
                        )}
                        {(task as { isPrivate?: boolean }).isPrivate && (
                            <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {task.project && (
                            <span className="truncate max-w-[150px]" dir="auto">{task.project.name}</span>
                        )}
                        <InlineDueDateEditor taskId={task.id} dueAt={task.dueAt} isOverdue={!!overdue} />
                        <Badge variant="outline" className="text-xs py-0">{task.status}</Badge>
                        <TableCellAssist entityId={task.id} columnKey="status" />
                        <CommentCountChip count={(task as { _count?: { comments?: number } })._count?.comments ?? 0} />
                    </div>
                </div>

                {/* Assignees */}
                <div className="flex -space-x-2.5 shrink-0">
                    {task.assignments.length === 0 ? (
                        <div className="w-6 h-6 rounded-full border border-dashed flex items-center justify-center text-[10px] text-muted-foreground">
                            ?
                        </div>
                    ) : (
                        task.assignments.slice(0, 3).map((a) => (
                            <Avatar key={a.id} className={cn(
                                "h-6 w-6 ring-2",
                                a.userId === userId ? "ring-primary/60" : "ring-background"
                            )}>
                                <AvatarImage src={a.user.image || ""} />
                                <AvatarFallback className="text-[10px]">{getInitials(a.user.name)}</AvatarFallback>
                            </Avatar>
                        ))
                    )}
                </div>
                <TableCellAssist entityId={task.id} columnKey="assigneeIds" />

                {/* Actions */}
                {isAssignedToMe && task.status !== "DONE" && task.status !== "CANCELED" && (
                    <MarkDoneButton taskId={task.id} currentStatus={task.status} taskType={task.type} />
                )}
                <TaskRowMenu taskId={task.id} taskTitle={task.title} taskType={task.type} canEdit={isAssignedToMe || task.createdById === userId} />
                {showClaim && (
                    <ClaimTaskButton taskId={task.id} taskTitle={task.title} />
                )}
                {showUndo && (
                    <Button size="sm" variant="outline" className="sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Undo
                    </Button>
                )}
                {/* Show Offer Help for tasks with support requests if not already assigned */}
                {hasOpenSupport && !isAssignedToMe && (
                    <OfferHelpButton taskId={task.id} taskTitle={task.title} />
                )}
                </div>
            </div>
        </Link>
    );
}

export default async function TasksPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | undefined>>;
}) {
    const session = await auth();
    if (!session?.user) return null;

    const resolvedParams = await searchParams;
    if (resolvedParams.legacy !== "1") return <TaskViewSwitcher />;
    const tab = resolvedParams.tab || "my";
    const view = resolvedParams.view || "list";
    const search = resolvedParams.search;
    const memberId = resolvedParams.member;
    const priority = resolvedParams.priority;
    const due = resolvedParams.due;
    const sort = resolvedParams.sort;

    const data = await getTasksData(session.user.id, tab, search, memberId, priority, due, sort);

    // Determine which tasks to show based on tab
    const currentTasks = tab === "my" ? data.myTasks
        : tab === "pool" ? data.teamPool
            : tab === "team" ? data.teamTasks
                : tab === "support" ? data.needSupportTasks
                    : data.completed;

    const pageTitle = tab === "my" ? "My Tasks"
        : tab === "pool" ? "Team Pool"
            : tab === "team" ? "Team Tasks"
                : tab === "support" ? "Need Support"
                    : "Completed";

    // Switching tab or view must not silently discard the filters the user just set.
    const hrefWith = (overrides: Record<string, string | undefined>) => {
        const next = new URLSearchParams();
        const merged = { tab, view, search, member: memberId, priority, due, sort, ...overrides };
        for (const [key, value] of Object.entries(merged)) {
            if (value) next.set(key, value);
        }
        return `/tasks?${next.toString()}`;
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" dir="auto">{pageTitle}</h1>
                    <p className="text-sm text-muted-foreground">
                        {tab === "my" && "Tasks assigned to you"}
                        {tab === "pool" && "Unassigned tasks available to claim"}
                        {tab === "team" && "View your team members' workload"}
                        {tab === "support" && "Tasks that need assistance"}
                        {tab === "completed" && "Recently completed tasks"}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 max-sm:sticky max-sm:top-2 max-sm:z-20">
                    <Button variant="outline" size="sm" asChild>
                        <a href="/api/tasks/export" download>
                            <Download className="mr-2 h-4 w-4" />
                            Export CSV
                        </a>
                    </Button>
                    <Button size="sm" asChild>
                        <Link href="/tasks/new">
                            <Plus className="mr-2 h-4 w-4" />
                            New Task
                        </Link>
                    </Button>
                </div>
            </div>

            {/* Search, sort, due-window and priority filters — glass-sticky on phones */}
            <div className="max-sm:sticky-glass max-sm:-mx-4 max-sm:px-4 max-sm:py-2">
                <TaskFilterBar />
            </div>

            {/* Tab Navigation */}
            <div className="tab-track scroll-touch -mx-4 flex items-center gap-1 overflow-x-auto px-4 border-b max-sm:bg-transparent max-sm:rounded-none max-sm:p-0 md:mx-0 md:px-0">
                <Link
                    href={hrefWith({ tab: "my", member: undefined })}
                    className={cn(
                        "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                        tab === "my"
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                >
                    <User className="h-4 w-4" />
                    My Tasks
                    <Badge variant="secondary" className="ml-1">{data.counts.my}</Badge>
                </Link>
                <Link
                    href={hrefWith({ tab: "pool", member: undefined })}
                    className={cn(
                        "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                        tab === "pool"
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Hand className="h-4 w-4" />
                    Pool
                    <Badge variant="secondary" className="ml-1">{data.counts.pool}</Badge>
                </Link>
                <Link
                    href={hrefWith({ tab: "team" })}
                    className={cn(
                        "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                        tab === "team"
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Eye className="h-4 w-4" />
                    Team
                    <Badge variant="secondary" className="ml-1">{data.counts.team}</Badge>
                </Link>
                {data.counts.support > 0 && (
                    <Link
                        href={hrefWith({ tab: "support", member: undefined })}
                        className={cn(
                            "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                            tab === "support"
                                ? "border-yellow-500 text-yellow-600"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <HelpCircle className="h-4 w-4" />
                        Help
                        <Badge variant="outline" className="ml-1 border-yellow-500 text-yellow-600">{data.counts.support}</Badge>
                    </Link>
                )}
                <Link
                    href={hrefWith({ tab: "completed", member: undefined })}
                    className={cn(
                        "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                        tab === "completed"
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                >
                    <CheckCircle2 className="h-4 w-4" />
                    Done
                    <Badge variant="secondary" className="ml-1">{data.counts.completed}</Badge>
                </Link>

                {/* View Toggle - Right side */}
                <div className="ml-auto flex items-center gap-1 pb-1">
                    <Button
                        variant={view === "list" ? "secondary" : "ghost"}
                        size="sm"
                        asChild
                    >
                        <Link href={hrefWith({ view: "list" })}>
                            <List className="h-4 w-4" />
                        </Link>
                    </Button>
                    <Button
                        variant={view === "board" ? "secondary" : "ghost"}
                        size="sm"
                        asChild
                    >
                        <Link href={hrefWith({ view: "board" })}>
                            <LayoutGrid className="h-4 w-4" />
                        </Link>
                    </Button>
                </div>
            </div>

            {/* Team Members Filter (for Team tab) */}
            {tab === "team" && data.teamMembers.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                    <Button
                        variant={!memberId ? "default" : "outline"}
                        size="sm"
                        asChild
                    >
                        <Link href={hrefWith({ tab: "team" })}>All Team</Link>
                    </Button>
                    {data.teamMembers.map((member) => (
                        <Button
                            key={member.id}
                            variant={memberId === member.id ? "default" : "outline"}
                            size="sm"
                            asChild
                        >
                            <Link href={hrefWith({ tab: "team", member: member.id })}>
                                <Avatar className="h-5 w-5 mr-2">
                                    <AvatarImage src={member.image || ""} />
                                    <AvatarFallback className="text-xs">{getInitials(member.name)}</AvatarFallback>
                                </Avatar>
                                {member.name?.split(" ")[0]}
                                <Badge variant="secondary" className="ml-1 text-xs">{member.taskCount}</Badge>
                                {member.urgentCount > 0 && (
                                    <Badge variant="destructive" className="ml-1 text-xs">{member.urgentCount}</Badge>
                                )}
                            </Link>
                        </Button>
                    ))}
                </div>
            )}

            {/* Content */}
            {view === "board" && tab !== "completed" && tab !== "support" && tab !== "team" ? (
                <KanbanBoard tasksByStatus={data.tasksByStatus} />
            ) : (
                <div className="space-y-2">
                    {currentTasks.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-16">
                                {search ? (
                                    <>
                                        <Search className="h-12 w-12 text-muted-foreground mb-4" />
                                        <p className="text-lg font-medium">No results found</p>
                                        <p className="text-muted-foreground mb-4">No tasks matching &quot;{search}&quot;</p>
                                        <Button variant="outline" asChild>
                                            <Link href={`/tasks?tab=${tab}`}>
                                                Clear Search
                                            </Link>
                                        </Button>
                                    </>
                                ) : tab === "my" ? (
                                    <>
                                        <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
                                        <p className="text-lg font-medium">You&apos;re all caught up!</p>
                                        <p className="text-muted-foreground mb-4">No tasks assigned to you right now.</p>
                                        <Button variant="outline" asChild>
                                            <Link href={hrefWith({ tab: "pool", member: undefined })}>
                                                <Hand className="mr-2 h-4 w-4" />
                                                Browse Team Pool
                                            </Link>
                                        </Button>
                                    </>
                                ) : tab === "pool" ? (
                                    <>
                                        <Users className="h-12 w-12 text-muted-foreground mb-4" />
                                        <p className="text-muted-foreground">No unassigned tasks available</p>
                                    </>
                                ) : tab === "team" ? (
                                    <>
                                        <Users className="h-12 w-12 text-muted-foreground mb-4" />
                                        <p className="text-muted-foreground">No team tasks to display</p>
                                    </>
                                ) : tab === "support" ? (
                                    <>
                                        <HelpCircle className="h-12 w-12 text-muted-foreground mb-4" />
                                        <p className="text-muted-foreground">No tasks requesting support</p>
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 className="h-12 w-12 text-muted-foreground mb-4" />
                                        <p className="text-muted-foreground">No completed tasks yet</p>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    ) : (
                        currentTasks.map((task) => (
                            <TaskRow
                                key={task.id}
                                task={task}
                                userId={session.user.id}
                                showClaim={tab === "pool"}
                                showUndo={tab === "completed"}
                                showHelp={tab === "team" || tab === "support"}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
