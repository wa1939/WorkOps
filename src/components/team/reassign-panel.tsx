"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { WorkloadBreakdown, type WorkloadBreakdownProps } from "@/components/team/workload-breakdown";

export interface HeatCellTask {
    id: string;
    title: string;
    effortHours: number | null;
}

export interface MoveTarget {
    userId: string;
    name: string;
    loadPercent: number;
}

interface ReassignPanelProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userName: string;
    weekLabel: string;
    tasks: HeatCellTask[];
    targets: MoveTarget[]; // other users, sorted by this-week load ascending
    canMove: boolean;
    workload?: WorkloadBreakdownProps;
}

export function ReassignPanel({ open, onOpenChange, userName, weekLabel, tasks, targets, canMove, workload }: ReassignPanelProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [movedIds, setMovedIds] = useState<Set<string>>(new Set());
    const [, startTransition] = useTransition();

    const move = async (taskId: string, targetUserId: string, targetName: string) => {
        setMovedIds((s) => new Set(s).add(taskId));
        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ assigneeIds: [targetUserId] }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast({ title: "Task reassigned", description: `Moved to ${targetName}.` });
            startTransition(() => router.refresh());
        } catch (err) {
            setMovedIds((s) => { const n = new Set(s); n.delete(taskId); return n; });
            toast({ variant: "destructive", title: "Move failed", description: (err as Error).message });
        }
    };

    const visible = tasks.filter((t) => !movedIds.has(t.id));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{userName} — week of {weekLabel}</DialogTitle>
                    <DialogDescription>
                        {canMove
                            ? "Move a task to a teammate with more slack this week."
                            : "Tasks due this week. Only managers can reassign."}
                    </DialogDescription>
                </DialogHeader>

                {workload && (
                    <div className="border-b pb-3">
                        <WorkloadBreakdown {...workload} />
                    </div>
                )}

                {visible.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">No tasks due this week.</p>
                ) : (
                    <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
                        {visible.map((t) => (
                            <li key={t.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                                <div className="flex-1 min-w-0">
                                    <Link href={`/tasks/${t.id}`} className="text-sm line-clamp-1 hover:text-primary transition-colors">
                                        {t.title}
                                    </Link>
                                    <span className="text-[11px] text-muted-foreground">{t.effortHours ?? 1}h</span>
                                </div>
                                {canMove && targets.length > 0 && (
                                    <Select onValueChange={(uid) => {
                                        const tgt = targets.find((x) => x.userId === uid);
                                        if (tgt) move(t.id, tgt.userId, tgt.name);
                                    }}>
                                        <SelectTrigger className="w-[180px] h-8 text-xs">
                                            <SelectValue placeholder="Move to…" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {targets.map((tgt) => (
                                                <SelectItem key={tgt.userId} value={tgt.userId}>
                                                    <span className={cn(
                                                        tgt.loadPercent > 100 ? "text-red-500" : tgt.loadPercent > 85 ? "text-orange-500" : "text-emerald-600",
                                                    )}>
                                                        {tgt.name.split(" ")[0]} — {tgt.loadPercent}%
                                                    </span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </DialogContent>
        </Dialog>
    );
}
