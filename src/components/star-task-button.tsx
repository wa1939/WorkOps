"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarTaskButtonProps {
    taskId: string;
    isStarred: boolean;
    size?: number;
    className?: string;
}

export function StarTaskButton({ taskId, isStarred, size = 16, className }: StarTaskButtonProps) {
    const router = useRouter();
    const [optimisticStarred, setOptimisticStarred] = useState(isStarred);
    const [, startTransition] = useTransition();

    const toggle = async (e: React.MouseEvent | React.KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !optimisticStarred;
        setOptimisticStarred(next);
        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isStarred: next }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            startTransition(() => router.refresh());
        } catch {
            setOptimisticStarred(!next);
        }
    };

    return (
        <button
            type="button"
            aria-label={optimisticStarred ? "Unstar task" : "Star task"}
            aria-pressed={optimisticStarred}
            onClick={toggle}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") toggle(e);
            }}
            className={cn(
                "inline-flex items-center justify-center rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                optimisticStarred
                    ? "text-amber-400 hover:text-amber-500"
                    : "text-muted-foreground/40 hover:text-amber-400",
                className,
            )}
        >
            <Star
                width={size}
                height={size}
                className={cn(optimisticStarred && "fill-amber-400")}
            />
        </button>
    );
}
