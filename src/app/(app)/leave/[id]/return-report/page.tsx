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
    CheckCircle2,
    Circle,
    Clock,
    FileText,
    User,
} from "lucide-react";
import Link from "next/link";
import { getInitials, formatDate, cn } from "@/lib/utils";

async function getLeaveWithHandovers(id: string) {
    const leave = await prisma.leaveRequest.findUnique({
        where: { id },
        include: {
            user: true,
            delegate: true,
            handovers: {
                include: {
                    tasks: {
                        include: {
                            task: true,
                        },
                    },
                    toUser: true,
                    fromUser: true,
                },
            },
        },
    });

    return leave;
}

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
    DONE: { label: "Done", icon: CheckCircle2, className: "text-green-600" },
    TODO: { label: "To Do", icon: Circle, className: "text-muted-foreground" },
    DOING: { label: "In Progress", icon: Clock, className: "text-blue-600" },
    BLOCKED: { label: "Blocked", icon: Circle, className: "text-red-600" },
    WAITING: { label: "Waiting", icon: Clock, className: "text-yellow-600" },
    CANCELED: { label: "Canceled", icon: Circle, className: "text-muted-foreground line-through" },
};

export default async function ReturnReportPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await auth();
    if (!session?.user) return null;

    const { id } = await params;
    const leave = await getLeaveWithHandovers(id);

    if (!leave) {
        notFound();
    }

    const allTasks = leave.handovers.flatMap((h) => h.tasks);
    const completedTasks = allTasks.filter((t) => t.task.status === "DONE");
    const completionRate = allTasks.length > 0
        ? Math.round((completedTasks.length / allTasks.length) * 100)
        : 0;

    return (
        <div className="max-w-3xl mx-auto animate-fade-in">
            <div className="mb-6">
                <Button variant="ghost" asChild>
                    <Link href="/leave">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Leave
                    </Link>
                </Button>
            </div>

            {/* Header */}
            <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-6 w-6 text-primary" />
                    <h1 className="text-3xl font-bold tracking-tight">Return Report</h1>
                </div>
                <p className="text-muted-foreground">
                    Leave period: {formatDate(leave.startAt)} - {formatDate(leave.endAt)}
                </p>
            </div>

            {/* Summary Card */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle className="text-lg">Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                        <div className="flex items-center gap-3">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <div>
                                <p className="text-sm text-muted-foreground">Employee</p>
                                <div className="flex items-center gap-2">
                                    <Avatar className="h-6 w-6">
                                        <AvatarImage src={leave.user.image || ""} />
                                        <AvatarFallback className="text-xs">
                                            {getInitials(leave.user.name)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <span className="font-medium">{leave.user.name}</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <div>
                                <p className="text-sm text-muted-foreground">Delegate</p>
                                <div className="flex items-center gap-2">
                                    <Avatar className="h-6 w-6">
                                        <AvatarImage src={leave.delegate.image || ""} />
                                        <AvatarFallback className="text-xs">
                                            {getInitials(leave.delegate.name)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <span className="font-medium">{leave.delegate.name}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t">
                        <div className="text-center">
                            <p className="text-2xl font-bold">{allTasks.length}</p>
                            <p className="text-sm text-muted-foreground">Total Tasks</p>
                        </div>
                        <div className="text-center">
                            <p className="text-2xl font-bold text-green-600">{completedTasks.length}</p>
                            <p className="text-sm text-muted-foreground">Completed</p>
                        </div>
                        <div className="text-center">
                            <p className="text-2xl font-bold">{completionRate}%</p>
                            <p className="text-sm text-muted-foreground">Completion Rate</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Handover Details */}
            {leave.handovers.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-16">
                        <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">No handover tasks were assigned for this leave</p>
                    </CardContent>
                </Card>
            ) : (
                leave.handovers.map((handover) => (
                    <Card key={handover.id} className="mb-4">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-lg">
                                        Handed to {handover.toUser.name}
                                    </CardTitle>
                                    <CardDescription>
                                        {handover.tasks.length} task(s) assigned
                                    </CardDescription>
                                </div>
                                <Badge variant="outline">
                                    {handover.tasks.filter((t) => t.task.status === "DONE").length}/{handover.tasks.length} done
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {handover.note && (
                                <div className="p-3 rounded-lg bg-muted/50 text-sm mb-4">
                                    <p className="text-muted-foreground font-medium mb-1">Handover Notes:</p>
                                    <p>{handover.note}</p>
                                </div>
                            )}
                            {handover.tasks.map((ht) => {
                                const config = statusConfig[ht.task.status] || statusConfig.TODO;
                                const StatusIcon = config.icon;

                                return (
                                    <div
                                        key={ht.id}
                                        className="flex items-center gap-3 p-3 rounded-lg border"
                                    >
                                        <StatusIcon className={cn("h-5 w-5", config.className)} />
                                        <span className={cn(
                                            "flex-1",
                                            ht.task.status === "CANCELED" && "line-through text-muted-foreground"
                                        )}>
                                            {ht.task.title}
                                        </span>
                                        <Badge
                                            variant="outline"
                                            className={cn("text-xs", config.className)}
                                        >
                                            {config.label}
                                        </Badge>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                ))
            )}
        </div>
    );
}
