import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    ArrowLeft,
    Calendar,
    Building2,
    FileText,
    Plus,
    Printer
} from "lucide-react";
import Link from "next/link";
import { formatDate, getInitials, cn, isOverdue } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { DeleteButton } from "@/components/delete-button";
import { ParentWorkAreaPicker } from "@/components/pmo/parent-work-area-picker";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { ExternalActionsList } from "@/components/pmo/external-actions-list";
import { getDueBucket, toRiyadhDate } from "@/lib/pmo/date";

async function getCaseStudy(id: string) {
    const caseStudy = await prisma.caseStudy.findUnique({
        where: { id },
        include: {
            owner: true,
            workArea: true,
            members: { include: { user: true } },
            departments: { include: { department: true } },
            tasks: {
                include: { assignments: { include: { user: true } }, externalAction: { include: { owner: true, externalContact: true, evidence: true, followUpEvents: { where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" }, take: 1 } } } },
                orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
            },
        },
    });

    return caseStudy;
}

const statusColors: Record<string, string> = {
    Open: "bg-blue-500/10 text-blue-600",
    "In Progress": "bg-yellow-500/10 text-yellow-600",
    "Under Review": "bg-purple-500/10 text-purple-600",
    Done: "bg-green-500/10 text-green-600",
    Archived: "bg-gray-500/10 text-gray-600",
};

export default async function CaseStudyDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await auth();
    if (!session?.user) return null;

    const { id } = await params;
    const cs = await getCaseStudy(id);
    const workAreas = await prisma.workArea.findMany({ where: { isArchived: false }, select: { id: true, name: true }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
    const pmoActor = await getCurrentPmoActor();

    if (!cs) {
        notFound();
    }

    const ordinaryTasks = cs.tasks.filter((task) => task.type === "STANDARD");
    const externalTasks = cs.tasks.filter((task) => task.type === "EXTERNAL_ACTION" && task.externalAction && task.dueAt);
    const openTasks = ordinaryTasks.filter((t) => !["DONE", "CANCELED"].includes(t.status));
    const hasReport = Boolean(cs.reportBody);

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="mb-6 flex items-center justify-between">
                <Button variant="ghost" asChild>
                    <Link href="/case-studies">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Case Studies
                    </Link>
                </Button>
                {hasReport && (
                    <Button variant="outline" className="print:hidden">
                        <Printer className="mr-2 h-4 w-4" />
                        Print Report
                    </Button>
                )}
            </div>

            {/* Header */}
            <div className="mb-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                            <Badge className={statusColors[cs.status] || ""}>
                                {cs.status}
                            </Badge>
                            {hasReport && (
                                <Badge variant="secondary" className="gap-1">
                                    <FileText className="h-3 w-3" />
                                    Report Ready
                                </Badge>
                            )}
                        </div>
                        <h1 className="text-3xl font-bold">{cs.name}</h1>
                        <div className="mt-3"><ParentWorkAreaPicker parentType="case-study" parentId={cs.id} currentWorkAreaId={cs.workAreaId} expectedUpdatedAt={new Date(cs.updatedAt).toISOString()} workAreas={workAreas} canEditParent={Boolean(pmoActor && (cs.ownerId === pmoActor.id || pmoActor.role === "ADMIN"))} /></div>
                        {cs.brief && (
                            <p className="text-muted-foreground mt-2">{cs.brief}</p>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button>Edit</Button>
                        <DeleteButton
                            entityType="case-study"
                            entityId={cs.id}
                            entityName={cs.name}
                            redirectUrl="/case-studies"
                        />
                    </div>
                </div>

                {/* Quick Info */}
                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    {cs.dueAt && (
                        <div className={cn("flex items-center gap-1", isOverdue(cs.dueAt) && cs.status !== "Done" && "text-red-500")}>
                            <Calendar className="h-4 w-4" />
                            <span>Due {formatDate(cs.dueAt)}</span>
                        </div>
                    )}
                </div>

                {/* Requesting Departments */}
                {cs.departments.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                        {cs.departments.map((d) => (
                            <Badge key={d.id} variant="outline" className="gap-1">
                                <Building2 className="h-3 w-3" />
                                {d.department.name}
                            </Badge>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Report */}
                    {hasReport && (
                        <Card className="print-section">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <FileText className="h-5 w-5" />
                                    Report
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="prose prose-neutral dark:prose-invert max-w-none">
                                <ReactMarkdown>{cs.reportBody || ""}</ReactMarkdown>
                            </CardContent>
                        </Card>
                    )}

                    {/* Tasks */}
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Tasks</CardTitle>
                                <CardDescription>{openTasks.length} open tasks</CardDescription>
                            </div>
                            <div className="flex gap-2"><Button size="sm" variant="outline" asChild><Link href={`/pmo/actions/new?caseStudyId=${cs.id}`}>Add external action</Link></Button><Button size="sm" asChild><Link href="/tasks/new"><Plus className="mr-2 h-4 w-4" />Add Task</Link></Button></div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {ordinaryTasks.length === 0 ? (
                                    <p className="text-center text-muted-foreground py-8">No tasks yet</p>
                                ) : (
                                    ordinaryTasks.map((task) => (
                                        <Link
                                            key={task.id}
                                            href={`/tasks/${task.id}`}
                                            className={cn(
                                                "flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors",
                                                task.status === "DONE" && "opacity-60"
                                            )}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p className={cn("font-medium", task.status === "DONE" && "line-through")}>
                                                    {task.title}
                                                </p>
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                    <Badge variant="outline" className="text-xs">{task.status}</Badge>
                                                    {task.dueAt && (
                                                        <span>Due {formatDate(task.dueAt)}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex -space-x-1">
                                                {task.assignments.slice(0, 3).map((a) => (
                                                    <Avatar key={a.id} className="h-6 w-6 border-2 border-background">
                                                        <AvatarImage src={a.user.image || ""} />
                                                        <AvatarFallback className="text-xs">{getInitials(a.user.name)}</AvatarFallback>
                                                    </Avatar>
                                                ))}
                                            </div>
                                        </Link>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>
                    <Card><CardHeader><CardTitle>External Actions</CardTitle><CardDescription>{externalTasks.length} PMO follow-ups</CardDescription></CardHeader><CardContent><ExternalActionsList actions={externalTasks.map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, dueDate: toRiyadhDate(task.dueAt!), dueBucket: getDueBucket(toRiyadhDate(task.dueAt!), task.status, toRiyadhDate(new Date())), ownerName: task.externalAction!.owner.name, contactName: task.externalAction!.externalContact.name, department: task.externalAction!.externalContact.department, parentName: cs.name, workAreaName: cs.workArea?.name ?? "Unclassified", evidenceCount: task.externalAction!.evidence.length, lastSentAt: task.externalAction!.followUpEvents[0]?.sentAt?.toISOString() ?? null }))} /></CardContent></Card>
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
                                {cs.owner && (
                                    <div className="flex items-center gap-3">
                                        <Avatar className="h-8 w-8">
                                            <AvatarImage src={cs.owner.image || ""} />
                                            <AvatarFallback className="text-xs">{getInitials(cs.owner.name)}</AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <p className="text-sm font-medium">{cs.owner.name}</p>
                                            <p className="text-xs text-muted-foreground">Owner</p>
                                        </div>
                                    </div>
                                )}
                                {cs.members.map((member) => (
                                    <div key={member.id} className="flex items-center gap-3">
                                        <Avatar className="h-8 w-8">
                                            <AvatarImage src={member.user.image || ""} />
                                            <AvatarFallback className="text-xs">{getInitials(member.user.name)}</AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <p className="text-sm font-medium">{member.user.name}</p>
                                            <p className="text-xs text-muted-foreground">Member</p>
                                        </div>
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
                                <span>{formatDate(cs.createdAt)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Updated</span>
                                <span>{formatDate(cs.updatedAt)}</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
