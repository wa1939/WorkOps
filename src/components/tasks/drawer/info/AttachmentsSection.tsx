import type { TaskDrawerPayload } from "../types";
import { dateLabel } from "./shared";

export function AttachmentsSection({ task }: { task: TaskDrawerPayload }) {
    return (
        <div className="space-y-2">
            {task.attachments.length === 0 && <p className="text-sm text-muted-foreground">No attachments.</p>}
            {task.attachments.map((attachment) => (
                <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-md border border-border/70 px-3 py-2 text-sm hover:bg-accent"
                >
                    <span className="min-w-0 flex-1 truncate font-medium">{attachment.filename || attachment.url}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{dateLabel(attachment.createdAt)}</span>
                </a>
            ))}
        </div>
    );
}
