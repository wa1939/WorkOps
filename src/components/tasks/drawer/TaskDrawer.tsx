"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DrawerHeader } from "./DrawerHeader";
import type { TaskDrawerPayload, TaskDrawerPatch } from "./types";
import { useTaskDrawer } from "./useTaskDrawer";

function TabSkeleton() {
    return (
        <div className="space-y-3" aria-label="Loading tab">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
        </div>
    );
}

const InfoTab = dynamic(() => import("./InfoTab").then((module) => module.InfoTab), { ssr: false, loading: () => <TabSkeleton /> });
const TimeTab = dynamic(() => import("./TimeTab").then((module) => module.TimeTab), { ssr: false, loading: () => <TabSkeleton /> });
const ActivityTab = dynamic(() => import("./ActivityTab").then((module) => module.ActivityTab), { ssr: false, loading: () => <TabSkeleton /> });

function errorMessage(body: unknown): string {
    if (body && typeof body === "object" && "error" in body) {
        const error = (body as { error?: unknown }).error;
        if (typeof error === "string") return error;
    }
    return "Could not load task";
}

export function TaskDrawer() {
    const { taskId, tab, commentId, ids, close, setTab, previous, next } = useTaskDrawer();
    const [task, setTask] = useState<TaskDrawerPayload | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refreshTask = useCallback(async () => {
        if (!taskId) return;
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorMessage(body));
        setTask(body as TaskDrawerPayload);
    }, [taskId]);

    useEffect(() => {
        if (!taskId) {
            setTask(null);
            setError(null);
            setLoading(false);
            return;
        }
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        setTask(null);
        fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store", signal: controller.signal })
            .then(async (response) => {
                const body = await response.json().catch(() => null);
                if (!response.ok) throw new Error(errorMessage(body));
                return body as TaskDrawerPayload;
            })
            .then((body) => setTask(body))
            .catch((cause: unknown) => {
                if (cause instanceof DOMException && cause.name === "AbortError") return;
                setError(cause instanceof Error ? cause.message : "Could not load task");
            })
            .finally(() => setLoading(false));
        return () => controller.abort();
    }, [taskId]);

    const updateTask = useCallback(async (patch: TaskDrawerPatch): Promise<TaskDrawerPayload> => {
        if (!taskId) throw new Error("No task selected");
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorMessage(body));
        const nextTask = body as TaskDrawerPayload;
        setTask(nextTask);
        return nextTask;
    }, [taskId]);

    const copyLink = useCallback(() => {
        if (!task || typeof window === "undefined") return;
        const url = new URL(window.location.href);
        url.searchParams.set("task", task.id);
        url.searchParams.set("tab", tab);
        void navigator.clipboard?.writeText(url.toString());
    }, [tab, task]);

    const index = taskId ? ids.indexOf(taskId) : -1;
    const position = index >= 0 ? index + 1 : 0;

    return (
        <Sheet open={Boolean(taskId)} onOpenChange={(open) => { if (!open) close(); }} modal={false}>
            <SheetContent side="right" className="h-[100dvh] w-full max-w-full gap-0 overflow-hidden p-0 sm:h-full sm:w-[720px] sm:rounded-l-lg" aria-describedby="task-drawer-description">
                <SheetDescription id="task-drawer-description" className="sr-only">Task details and activity</SheetDescription>
                {task && (
                    <DrawerHeader
                        task={task}
                        tab={tab}
                        position={position}
                        total={ids.length}
                        onTabChange={setTab}
                        onUpdate={updateTask}
                        onPrevious={previous}
                        onNext={next}
                        onCopyLink={copyLink}
                        onClose={close}
                    />
                )}
                <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6", !task && "pt-16")}>
                    {loading && (
                        <div className="space-y-4" aria-label="Loading task">
                            <Skeleton className="h-5 w-2/3" />
                            <Skeleton className="h-24 w-full" />
                            <Skeleton className="h-32 w-full" />
                        </div>
                    )}
                    {!loading && error && (
                        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                            {error}
                        </div>
                    )}
                    {!loading && !error && task && (
                        <div role="tabpanel" aria-label={`${tab} tab`}>
                            {tab === "info" && <InfoTab task={task} commentId={commentId} onUpdate={updateTask} onRefresh={refreshTask} />}
                            {tab === "time" && <TimeTab taskId={task.id} />}
                            {tab === "activity" && <ActivityTab task={task} />}
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
