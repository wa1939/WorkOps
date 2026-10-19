import type { TaskDrawerPayload } from "./types";
import { dateLabel, userLabel } from "./info/shared";

export function ActivityTab({ task }: { task: TaskDrawerPayload }) {
    const entries = task.auditLogs;
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Activity</h2>
                <span className="text-xs text-muted-foreground">Latest first</span>
            </div>
            {entries.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                    <p>Activity history is ready for future events.</p>
                    {/* TODO: add event-specific activity projections as task mutations gain history entries. */}
                    <p className="mt-1 text-xs">Last updated {dateLabel(task.updatedAt)}.</p>
                </div>
            ) : (
                <ol className="relative space-y-4 border-l border-border pl-5">
                    {entries.map((entry) => (
                        <li key={entry.id} className="relative">
                            <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                            <p className="text-sm font-medium">{entry.action}</p>
                            <p className="text-xs text-muted-foreground">{userLabel(entry.actor)} · {dateLabel(entry.createdAt)}</p>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}
