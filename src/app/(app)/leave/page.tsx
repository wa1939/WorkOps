import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Plus,
    Calendar,
    ArrowRight,
    CheckCircle,
    Clock,
    User,
    FileText
} from "lucide-react";
import Link from "next/link";
import { getInitials, formatDate, cn } from "@/lib/utils";

async function getLeaveData(userId: string) {
    const now = new Date();

    // My leave requests
    const myLeaves = await prisma.leaveRequest.findMany({
        where: { userId },
        include: {
            delegate: true,
            handovers: {
                include: {
                    tasks: { include: { task: true } },
                    toUser: true,
                },
            },
        },
        orderBy: { startAt: "desc" },
    });

    // Leaves where I'm the delegate
    const delegatedToMe = await prisma.leaveRequest.findMany({
        where: { delegateId: userId },
        include: {
            user: true,
            handovers: {
                include: {
                    tasks: { include: { task: true } },
                },
            },
        },
        orderBy: { startAt: "desc" },
    });

    // Current/upcoming leaves (for the team)
    const currentLeaves = await prisma.leaveRequest.findMany({
        where: {
            status: "Approved",
            endAt: { gte: now },
        },
        include: {
            user: true,
            delegate: true,
        },
        orderBy: { startAt: "asc" },
        take: 10,
    });

    return { myLeaves, delegatedToMe, currentLeaves };
}

export default async function LeavePage() {
    const session = await auth();
    if (!session?.user) return null;

    const { myLeaves, delegatedToMe, currentLeaves } = await getLeaveData(session.user.id);

    const now = new Date();

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" dir="auto">Leave & Handover</h1>
                    <p className="text-muted-foreground">Manage leave requests and task handovers</p>
                </div>
                <Button asChild className="max-sm:w-full">
                    <Link href="/leave/new">
                        <Plus className="mr-2 h-4 w-4" />
                        Request Leave
                    </Link>
                </Button>
            </div>

            {/* Current/Upcoming Team Leaves */}
            {currentLeaves.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Current & Upcoming Leaves</CardTitle>
                        <CardDescription>Team members on or going on leave</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {currentLeaves.map((leave) => {
                                const isOngoing = new Date(leave.startAt) <= now && new Date(leave.endAt) >= now;
                                return (
                                    <div
                                        key={leave.id}
                                        className={cn(
                                            "flex items-center gap-4 p-3 rounded-lg border",
                                            isOngoing && "bg-yellow-500/5 border-yellow-500/20"
                                        )}
                                    >
                                        <Avatar className="h-10 w-10">
                                            <AvatarImage src={leave.user.image || ""} />
                                            <AvatarFallback>{getInitials(leave.user.name)}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{leave.user.name}</span>
                                                {isOngoing && (
                                                    <Badge variant="secondary" className="text-xs">
                                                        Currently on leave
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-sm text-muted-foreground">
                                                {formatDate(leave.startAt)} - {formatDate(leave.endAt)}
                                            </p>
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                            <span>Delegate:</span>
                                            <span className="ml-1 font-medium">{leave.delegate.name}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}

            <Tabs defaultValue="my-leaves" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="my-leaves">My Leaves</TabsTrigger>
                    <TabsTrigger value="delegated">Delegated to Me</TabsTrigger>
                </TabsList>

                <TabsContent value="my-leaves" className="space-y-4">
                    {myLeaves.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-16">
                                <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
                                <p className="text-muted-foreground mb-4">No leave requests</p>
                                <Button asChild className="max-sm:w-full">
                                    <Link href="/leave/new">
                                        <Plus className="mr-2 h-4 w-4" />
                                        Request Leave
                                    </Link>
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        myLeaves.map((leave) => {
                            const isPast = new Date(leave.endAt) < now;
                            const isOngoing = new Date(leave.startAt) <= now && new Date(leave.endAt) >= now;
                            const totalTasks = leave.handovers.reduce((sum, h) => sum + h.tasks.length, 0);

                            return (
                                <Card key={leave.id} className={cn(isPast && "opacity-60")}>
                                    <CardHeader className="pb-3">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="flex items-center gap-3">
                                                <Calendar className="h-5 w-5 text-muted-foreground" />
                                                <div>
                                                    <CardTitle className="text-lg">
                                                        {formatDate(leave.startAt)} - {formatDate(leave.endAt)}
                                                    </CardTitle>
                                                    {leave.reason && (
                                                        <CardDescription>{leave.reason}</CardDescription>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Badge
                                                    className={cn(
                                                        leave.status === "Approved" && "bg-green-500/10 text-green-600",
                                                        leave.status === "Pending" && "bg-yellow-500/10 text-yellow-600",
                                                        leave.status === "Rejected" && "bg-red-500/10 text-red-600"
                                                    )}
                                                >
                                                    {leave.status}
                                                </Badge>
                                                {isOngoing && (
                                                    <Badge variant="secondary">Ongoing</Badge>
                                                )}
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="flex items-center gap-4 text-sm">
                                            <div className="flex items-center gap-2">
                                                <User className="h-4 w-4 text-muted-foreground" />
                                                <span className="text-muted-foreground">Delegate:</span>
                                                <Avatar className="h-6 w-6">
                                                    <AvatarImage src={leave.delegate.image || ""} />
                                                    <AvatarFallback className="text-xs">{getInitials(leave.delegate.name)}</AvatarFallback>
                                                </Avatar>
                                                <span className="font-medium">{leave.delegate.name}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <FileText className="h-4 w-4 text-muted-foreground" />
                                                <span>{totalTasks} tasks handed over</span>
                                            </div>
                                        </div>

                                        {isPast && (
                                            <Button variant="outline" asChild>
                                                <Link href={`/leave/${leave.id}/return-report`}>
                                                    View Return Report <ArrowRight className="ml-2 h-4 w-4" />
                                                </Link>
                                            </Button>
                                        )}
                                        {!isPast && leave.handovers.length === 0 && (
                                            <Button asChild className="max-sm:w-full">
                                                <Link href={`/leave/${leave.id}/edit`}>
                                                    Add Handover Tasks <ArrowRight className="ml-2 h-4 w-4" />
                                                </Link>
                                            </Button>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })
                    )}
                </TabsContent>

                <TabsContent value="delegated" className="space-y-4">
                    {delegatedToMe.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-16">
                                <CheckCircle className="h-12 w-12 text-muted-foreground mb-4" />
                                <p className="text-muted-foreground">No delegated leaves</p>
                            </CardContent>
                        </Card>
                    ) : (
                        delegatedToMe.map((leave) => {
                            const isPast = new Date(leave.endAt) < now;
                            const isOngoing = new Date(leave.startAt) <= now && new Date(leave.endAt) >= now;
                            const totalTasks = leave.handovers.reduce((sum, h) => sum + h.tasks.length, 0);
                            const openTasks = leave.handovers.reduce(
                                (sum, h) => sum + h.tasks.filter((t) => t.task.status !== "DONE").length,
                                0
                            );

                            return (
                                <Card key={leave.id} className={cn(isPast && "opacity-60")}>
                                    <CardHeader className="pb-3">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-10 w-10">
                                                    <AvatarImage src={leave.user.image || ""} />
                                                    <AvatarFallback>{getInitials(leave.user.name)}</AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <CardTitle className="text-lg">{leave.user.name}</CardTitle>
                                                    <CardDescription>
                                                        {formatDate(leave.startAt)} - {formatDate(leave.endAt)}
                                                    </CardDescription>
                                                </div>
                                            </div>
                                            {isOngoing && (
                                                <Badge variant="secondary">Ongoing</Badge>
                                            )}
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="flex items-center gap-4 text-sm">
                                            <div className="flex items-center gap-2">
                                                <FileText className="h-4 w-4 text-muted-foreground" />
                                                <span>{totalTasks} tasks handed to you</span>
                                            </div>
                                            {openTasks > 0 && (
                                                <Badge variant="outline" className="gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    {openTasks} open
                                                </Badge>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
