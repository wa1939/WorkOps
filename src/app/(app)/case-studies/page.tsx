import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, BookOpen, Calendar, Building2, FileText, Hand } from "lucide-react";
import Link from "next/link";
import { formatDate, getInitials, cn } from "@/lib/utils";

async function getCaseStudies(floating: boolean = false) {
    const where: Record<string, unknown> = {};

    if (floating) {
        where.ownerId = null;
    }

    const caseStudies = await prisma.caseStudy.findMany({
        where,
        include: {
            owner: true,
            members: { include: { user: true } },
            departments: { include: { department: true } },
            tasks: { select: { status: true } },
        },
        orderBy: { updatedAt: "desc" },
    });

    return caseStudies.map((cs) => {
        const totalTasks = cs.tasks.filter((t) => t.status !== "CANCELED").length;
        const doneTasks = cs.tasks.filter((t) => t.status === "DONE").length;
        const openTasks = cs.tasks.filter((t) => !["DONE", "CANCELED"].includes(t.status)).length;
        return { ...cs, totalTasks, doneTasks, openTasks };
    });
}

const statusColors: Record<string, string> = {
    Open: "bg-blue-500/10 text-blue-600",
    "In Progress": "bg-yellow-500/10 text-yellow-600",
    "Under Review": "bg-purple-500/10 text-purple-600",
    Done: "bg-green-500/10 text-green-600",
    Archived: "bg-gray-500/10 text-gray-600",
};

export default async function CaseStudiesPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | undefined>>;
}) {
    const session = await auth();
    if (!session?.user) return null;

    const resolvedParams = await searchParams;
    const floating = resolvedParams.floating === "true";
    const caseStudies = await getCaseStudies(floating);

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" dir="auto">
                        {floating ? "Unassigned Case Studies" : "Case Studies"}
                    </h1>
                    <p className="text-sm text-muted-foreground">Department-requested work with report outputs</p>
                </div>
                <Button asChild className="max-sm:w-full">
                    <Link href="/case-studies/new">
                        <Plus className="mr-2 h-4 w-4" />
                        New Case Study
                    </Link>
                </Button>
            </div>

            {/* Quick Filters — swipeable pill rail on phones */}
            <div className="scroll-touch edge-fade -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
                <Button variant={!floating ? "default" : "outline"} size="sm" className="shrink-0" asChild>
                    <Link href="/case-studies">All Case Studies</Link>
                </Button>
                <Button variant={floating ? "default" : "outline"} size="sm" className="shrink-0" asChild>
                    <Link href="/case-studies?floating=true">
                        <Hand className="mr-2 h-4 w-4" />
                        Unassigned
                    </Link>
                </Button>
            </div>

            <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
                {caseStudies.length === 0 ? (
                    <Card className="col-span-full">
                        <CardContent className="flex flex-col items-center justify-center py-16">
                            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
                            <p className="text-muted-foreground mb-4">No case studies yet</p>
                            <Button asChild>
                                <Link href="/case-studies/new">
                                    <Plus className="mr-2 h-4 w-4" />
                                    Create Case Study
                                </Link>
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    caseStudies.map((cs) => (
                        <Link key={cs.id} href={`/case-studies/${cs.id}`} className="card-press block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                            <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer">
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <CardTitle className="text-base sm:text-lg" dir="auto">{cs.name}</CardTitle>
                                        <Badge className={cn("shrink-0", statusColors[cs.status] || "")}>{cs.status}</Badge>
                                    </div>
                                    {cs.brief && (
                                        <CardDescription className="line-clamp-2" dir="auto">{cs.brief}</CardDescription>
                                    )}
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {/* Requesting Departments */}
                                    {cs.departments.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                            {cs.departments.map((d) => (
                                                <Badge key={d.id} variant="secondary" className="text-xs gap-1">
                                                    <Building2 className="h-3 w-3" />
                                                    {d.department.name}
                                                </Badge>
                                            ))}
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                                        <div className="flex items-center gap-4">
                                            <span className="nums">{cs.openTasks} open tasks</span>
                                            {cs.reportBody && (
                                                <span className="flex items-center gap-1 text-green-600">
                                                    <FileText className="h-4 w-4" />
                                                    Report ready
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-2 text-sm">
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                            {cs.dueAt && (
                                                <>
                                                    <Calendar className="h-4 w-4 shrink-0" />
                                                    <span className="nums">{formatDate(cs.dueAt)}</span>
                                                </>
                                            )}
                                        </div>
                                        <div className="flex -space-x-2">
                                            {cs.owner && (
                                                <Avatar className="h-6 w-6 border-2 border-background">
                                                    <AvatarImage src={cs.owner.image || ""} />
                                                    <AvatarFallback className="text-xs">{getInitials(cs.owner.name)}</AvatarFallback>
                                                </Avatar>
                                            )}
                                            {cs.members.slice(0, 3).map((m) => (
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
                    ))
                )}
            </div>
        </div>
    );
}
