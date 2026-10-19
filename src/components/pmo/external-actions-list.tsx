import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PmoActionRow } from "@/lib/pmo/portfolio-query";

export type ExternalActionListItem = Pick<
    PmoActionRow,
    | "id"
    | "title"
    | "status"
    | "priority"
    | "dueDate"
    | "dueBucket"
    | "ownerName"
    | "contactName"
    | "parentName"
    | "workAreaName"
> &
    Partial<PmoActionRow> & { department?: string | null; evidenceCount?: number; lastSentAt?: string | null };

export function ExternalActionsList({ actions }: { actions: ExternalActionListItem[] }) {
    if (!actions.length)
        return (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                No external actions match these filters.
            </div>
        );
    return (
        <div className="overflow-hidden rounded-xl border bg-card">
            {actions.map((action) => {
                const closed = action.status === "DONE" || action.status === "CANCELED";
                const evidenceCount = action.evidence?.length ?? action.evidenceCount ?? 0;
                const latestFollowUp = action.lastFollowUpAt ?? action.lastSentAt ?? null;
                return (
                    <div
                        key={action.id}
                        className="grid gap-3 border-b p-4 last:border-0 md:grid-cols-[minmax(0,1fr)_12rem_12rem_auto] md:items-center"
                    >
                        <div className="min-w-0">
                            <div className="mb-1 flex flex-wrap gap-2">
                                <Badge variant="outline">{action.workAreaName}</Badge>
                                <Badge variant={action.dueBucket === "OVERDUE" ? "destructive" : "secondary"}>
                                    {action.dueBucket.replace("_", " ")}
                                </Badge>
                                <Badge variant="outline">{action.status}</Badge>
                            </div>
                            <Link href={`/tasks/${action.id}`} className="font-semibold hover:underline" dir="auto">
                                {action.title}
                            </Link>
                            <p className="truncate text-sm text-muted-foreground" dir="auto">
                                {action.parentName} - {action.contactName}
                                {action.contactDepartment || action.department
                                    ? `, ${action.contactDepartment ?? action.department}`
                                    : ""}
                            </p>
                        </div>
                        <div className="text-sm">
                            <p>{action.ownerName}</p>
                            <p className="text-muted-foreground">Due {action.dueDate}</p>
                            <p className="text-muted-foreground">Next reminder {action.nextReminder ?? "None"}</p>
                        </div>
                        <div className="text-sm text-muted-foreground">
                            <p>{evidenceCount ? `${evidenceCount} evidence` : "Missing evidence"}</p>
                            <p>
                                Latest follow-up{" "}
                                {latestFollowUp ? new Date(latestFollowUp).toLocaleDateString() : "None"}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2 md:justify-end">
                            {!closed && (
                                <Button size="sm" variant="outline" asChild>
                                    <Link href={`/tasks/${action.id}#follow-up`}>Review draft</Link>
                                </Button>
                            )}
                            {!closed && (
                                <Button size="sm" asChild>
                                    <Link href={`/tasks/${action.id}#update-action`}>
                                        {action.dueBucket === "OVERDUE" ? "Record response" : "Update action"}
                                    </Link>
                                </Button>
                            )}
                            {closed && (
                                <Button size="sm" variant="outline" asChild>
                                    <Link href={`/tasks/${action.id}#follow-up`}>View history</Link>
                                </Button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
