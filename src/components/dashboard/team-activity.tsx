"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials, formatRelativeDate } from "@/lib/utils";

interface ActivityItem {
    id: string;
    action: string;
    createdAt: string | Date;
    actor: { name: string; image: string | null } | null;
    task: { title: string } | null;
}

export function TeamActivity({ items }: { items: ActivityItem[] }) {
    if (items.length === 0) return null;

    return (
        <div className="space-y-3">
            {items.map((item) => (
                <div key={item.id} className="flex items-start gap-3">
                    <Avatar className="h-7 w-7 mt-0.5">
                        <AvatarImage src={item.actor?.image || ""} />
                        <AvatarFallback className="text-xs bg-primary/10">
                            {item.actor ? getInitials(item.actor.name) : "?"}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm">
                            <span className="font-medium">{item.actor?.name ?? "Someone"}</span>{" "}
                            <span className="text-muted-foreground">
                                {item.action === "create" ? "created" : "updated"}
                            </span>{" "}
                            <span className="font-medium truncate">{item.task?.title ?? "a task"}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {formatRelativeDate(item.createdAt)}
                        </p>
                    </div>
                </div>
            ))}
        </div>
    );
}
