import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommentCountChipProps {
    count: number;
    className?: string;
}

/** Subtle inline chip showing comment count on task rows. Hidden when 0. */
export function CommentCountChip({ count, className }: CommentCountChipProps) {
    if (!count) return null;
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 text-xs text-muted-foreground",
                className,
            )}
            title={`${count} comment${count === 1 ? "" : "s"}`}
        >
            <MessageSquare className="h-3 w-3" />
            {count}
        </span>
    );
}
