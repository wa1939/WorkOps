import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, getInitials } from "@/lib/utils";
import { CheckCircle2, Activity, AlertTriangle, Clock, FolderPlus, ArrowUpRight } from "lucide-react";

export interface Workstream {
    id: string | null;
    name: string;
    isProject: boolean;
    openCount: number;
    doneCount: number;
    totalCount: number;
    topTasks: { id: string; title: string; status: string; assignees: string[] }[];
}

interface DepartmentPulseProps {
    doneThisWeek: number;
    doneLastWeek: number;
    inFlight: number;
    blocked: number;
    dueNext7: number;
    workstreams: Workstream[];
}

function taskDot(status: string): string {
    if (status === "DOING") return "bg-blue-500";
    if (status === "BLOCKED" || status === "WAITING") return "bg-red-500";
    return "bg-muted-foreground/40";
}

function WorkstreamCard({ ws }: { ws: Workstream }) {
    const progress = ws.totalCount > 0 ? Math.round((ws.doneCount / ws.totalCount) * 100) : 0;

    return (
        <Card className="h-full transition-shadow hover:shadow-md">
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                    {ws.isProject && ws.id ? (
                        <Link
                            href={`/projects/${ws.id}`}
                            dir="auto"
                            className="group inline-flex items-center gap-1 font-medium leading-snug hover:text-primary transition-colors"
                        >
                            <span className="line-clamp-2">{ws.name}</span>
                            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                        </Link>
                    ) : (
                        <span dir="auto" className="font-medium leading-snug line-clamp-2">
                            {ws.name}
                        </span>
                    )}
                    <Badge variant="secondary" className="shrink-0 text-[10px] tabular-nums">
                        {ws.openCount} open
                    </Badge>
                </div>
                {ws.isProject && ws.totalCount > 0 && (
                    <div className="mt-2.5 space-y-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                            {ws.doneCount} of {ws.totalCount} done
                        </p>
                    </div>
                )}
            </CardHeader>
            <CardContent>
                {ws.topTasks.length > 0 ? (
                    <div className="space-y-1.5">
                        {ws.topTasks.map((t) => (
                            <Link
                                key={t.id}
                                href={`/tasks/${t.id}`}
                                className="flex items-center gap-2 text-sm hover:text-primary transition-colors"
                            >
                                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", taskDot(t.status))} />
                                <span dir="auto" className="truncate">
                                    {t.title}
                                </span>
                                {t.assignees.length > 0 && (
                                    <span className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground">
                                        {getInitials(t.assignees[0])}
                                        {t.assignees.length > 1 && ` +${t.assignees.length - 1}`}
                                    </span>
                                )}
                            </Link>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs italic text-muted-foreground">No open tasks.</p>
                )}
            </CardContent>
        </Card>
    );
}

export function DepartmentPulse({
    doneThisWeek,
    doneLastWeek,
    inFlight,
    blocked,
    dueNext7,
    workstreams,
}: DepartmentPulseProps) {
    const delta = doneThisWeek - doneLastWeek;
    const deltaText =
        delta > 0 ? `↑ ${delta} vs last week` : delta < 0 ? `↓ ${Math.abs(delta)} vs last week` : "no change vs last week";
    const deltaClass = delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground";

    return (
        <div className="space-y-4">
            {/* Headline: a sentence, not a stat template */}
            <Card>
                <CardContent className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-5 w-5" />
                        </span>
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold tabular-nums leading-none">{doneThisWeek}</span>
                            <span className="text-sm text-muted-foreground">shipped this week</span>
                        </div>
                        <span className={cn("text-sm font-medium tabular-nums", deltaClass)}>{deltaText}</span>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-sm">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Activity className="h-3.5 w-3.5" />
                            <span className="tabular-nums font-medium text-foreground">{inFlight}</span> in flight
                        </span>
                        <span className="text-muted-foreground/30">·</span>
                        {blocked > 0 ? (
                            <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span className="tabular-nums font-medium">{blocked}</span> blocked
                            </span>
                        ) : (
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                                <span className="tabular-nums font-medium text-foreground">0</span> blocked
                            </span>
                        )}
                        <span className="text-muted-foreground/30">·</span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            <span className="tabular-nums font-medium text-foreground">{dueNext7}</span> due in 7 days
                        </span>
                    </div>
                </CardContent>
            </Card>

            {/* What we're working on */}
            {workstreams.length > 0 ? (
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold">What we&apos;re working on</h3>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {workstreams.map((ws) => (
                            <WorkstreamCard key={ws.id ?? "general"} ws={ws} />
                        ))}
                    </div>
                </div>
            ) : (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                        <FolderPlus className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm font-medium">No active workstreams</p>
                        <p className="max-w-sm text-sm text-muted-foreground">
                            Create a project to group the team&apos;s work, or the pulse will fill in as tasks come in.
                        </p>
                        <Link href="/projects/new" className="mt-1 text-sm font-medium text-primary hover:underline">
                            Create a project
                        </Link>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
