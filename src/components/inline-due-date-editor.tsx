"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface InlineDueDateEditorProps {
    taskId: string;
    dueAt: string | Date | null;
    className?: string;
    isOverdue?: boolean;
    allowClear?: boolean;
}

function toInputDate(d: Date | string | null): string {
    if (!d) return "";
    const dt = typeof d === "string" ? new Date(d) : d;
    if (Number.isNaN(dt.getTime())) return "";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function formatRelative(d: Date | null): string {
    if (!d) return "No due date";
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((startOfDate.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days === -1) return "Yesterday";
    if (days > 1 && days <= 7) return `In ${days} days`;
    if (days < -1 && days >= -7) return `${Math.abs(days)} days ago`;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function InlineDueDateEditor({ taskId, dueAt, className, isOverdue, allowClear = true }: InlineDueDateEditorProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [current, setCurrent] = useState<Date | null>(dueAt ? new Date(dueAt) : null);
    const [draft, setDraft] = useState<string>(toInputDate(dueAt));
    const [, startTransition] = useTransition();

    const stopBubble = (e: React.MouseEvent | React.KeyboardEvent) => {
        e.stopPropagation();
    };
    const handleTriggerClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
    };

    const save = async (isoDate: string | null) => {
        const previous = current;
        const nextDate = isoDate ? new Date(`${isoDate}T09:00:00`) : null;
        setCurrent(nextDate);
        setOpen(false);
        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dueAt: nextDate ? nextDate.toISOString() : null }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast({ title: "Due date updated", description: nextDate ? formatRelative(nextDate) : "No due date." });
            startTransition(() => router.refresh());
        } catch (err) {
            setCurrent(previous);
            toast({ variant: "destructive", title: "Could not update", description: (err as Error).message });
        }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={current ? `Due ${formatRelative(current)}. Click to change.` : "Set due date"}
                    aria-expanded={open}
                    onClick={handleTriggerClick}
                    onPointerDown={stopBubble}
                    className={cn(
                        "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded hover:bg-accent transition-colors",
                        isOverdue && "text-red-500 font-medium",
                        !current && "text-muted-foreground/60",
                        className,
                    )}
                >
                    <Calendar className="h-3 w-3" />
                    {formatRelative(current)}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="start" onClick={stopBubble}>
                <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-semibold">Due date</p>
                    <Input
                        type="date"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="text-sm"
                        autoFocus
                    />
                    <div className="flex justify-between gap-2 pt-1">
                        {current && allowClear && (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={(e) => { stopBubble(e); save(null); }}
                                className="text-xs text-muted-foreground gap-1"
                            >
                                <X className="h-3 w-3" /> Clear
                            </Button>
                        )}
                        <Button
                            type="button"
                            size="sm"
                            onClick={(e) => { stopBubble(e); save(draft || null); }}
                            className="ml-auto"
                        >
                            Save
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
