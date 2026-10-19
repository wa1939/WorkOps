"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

const options: { value: Priority; label: string; barClass: string; textClass: string }[] = [
    { value: "LOW", label: "Low", barClass: "bg-slate-400", textClass: "text-slate-600" },
    { value: "MEDIUM", label: "Medium", barClass: "bg-blue-500", textClass: "text-blue-600" },
    { value: "HIGH", label: "High", barClass: "bg-orange-500", textClass: "text-orange-600" },
    { value: "URGENT", label: "Urgent", barClass: "bg-red-500", textClass: "text-red-600" },
];

interface InlinePriorityEditorProps {
    taskId: string;
    priority: Priority;
    /** Optional custom trigger. Defaults to the priority indicator bar used in the tasks list. */
    children?: React.ReactNode;
}

export function InlinePriorityEditor({ taskId, priority, children }: InlinePriorityEditorProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [current, setCurrent] = useState<Priority>(priority);
    const [, startTransition] = useTransition();

    const barClass = options.find((o) => o.value === current)?.barClass ?? "bg-slate-400";

    const change = async (next: Priority) => {
        if (next === current) {
            setOpen(false);
            return;
        }
        const previous = current;
        setCurrent(next);
        setOpen(false);
        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ priority: next }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast({ title: "Priority updated", description: `Now ${options.find((o) => o.value === next)?.label}.` });
            startTransition(() => router.refresh());
        } catch (err) {
            setCurrent(previous);
            toast({ variant: "destructive", title: "Could not update priority", description: (err as Error).message });
        }
    };

    // Stop bubbling only — never preventDefault on the trigger (that would
    // block Radix's own toggle handler when asChild merges props).
    const stopBubble = (e: React.MouseEvent | React.KeyboardEvent) => {
        e.stopPropagation();
    };
    const stopAll = (e: React.MouseEvent | React.KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleTriggerClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {children ?? (
                    <button
                        type="button"
                        aria-label={`Priority: ${current}. Click to change.`}
                        aria-expanded={open}
                        onClick={handleTriggerClick}
                        onPointerDown={stopBubble}
                        className={cn(
                            "w-2 h-8 rounded-full flex-shrink-0 cursor-pointer transition-transform hover:scale-125",
                            barClass,
                        )}
                    />
                )}
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="start" onClick={stopBubble}>
                <div className="text-xs text-muted-foreground px-2 pb-2">Set priority</div>
                <div className="space-y-1">
                    {options.map((o) => (
                        <button
                            key={o.value}
                            type="button"
                            onClick={(e) => {
                                stopAll(e);
                                change(o.value);
                            }}
                            className={cn(
                                "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors",
                                current === o.value && "bg-accent/70 font-medium",
                            )}
                        >
                            <span className={cn("w-2 h-4 rounded-full", o.barClass)} />
                            <span className={o.textClass}>{o.label}</span>
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
