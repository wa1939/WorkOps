"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, Clipboard, PauseCircle, Pencil, X, XCircle, type LucideIcon } from "lucide-react";
import { SheetTitle } from "@/components/ui/sheet";
import type { Priority, TaskStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { priorityClass, statusClass } from "@/lib/ui/status-tokens";
import type { TaskDrawerPayload, TaskDrawerPatch } from "./types";
import type { TaskDrawerTab } from "./useTaskDrawer";

const STATUS_OPTIONS = ["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"] as const;
const PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const DRAWER_TABS = ["info", "time", "activity"] as const;
const DRAWER_PANEL_ID = "task-drawer-panel";
const STATUS_ICONS: Record<string, LucideIcon> = {
    TODO: Circle,
    DOING: Clock3,
    BLOCKED: PauseCircle,
    WAITING: Clock3,
    DONE: CheckCircle2,
    CANCELED: XCircle,
};

function priorityIconRotation(priority: string): string {
    if (priority === "LOW") return "rotate-180";
    if (priority === "MEDIUM") return "rotate-90";
    return "";
}

interface DrawerHeaderProps {
    task: TaskDrawerPayload;
    tab: TaskDrawerTab;
    position: number;
    total: number;
    onTabChange: (tab: TaskDrawerTab) => void;
    onUpdate: (patch: TaskDrawerPatch) => Promise<TaskDrawerPayload>;
    onPrevious: () => void;
    onNext: () => void;
    onCopyLink: () => void;
    onClose: () => void;
}

function label(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
}

export function DrawerHeader({ task, tab, position, total, onTabChange, onUpdate, onPrevious, onNext, onCopyLink, onClose }: DrawerHeaderProps) {
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(task.title);
    const [saving, setSaving] = useState(false);
    const titleRef = useRef<HTMLInputElement>(null);
    const editButtonRef = useRef<HTMLButtonElement>(null);
    const tabListRef = useRef<HTMLElement>(null);
    const shouldRestoreEditFocusRef = useRef(false);
    const StatusIcon = STATUS_ICONS[task.status] ?? Circle;
    const priorityRotation = priorityIconRotation(task.priority);

    useEffect(() => {
        if (!editing) setTitle(task.title);
    }, [editing, task.title]);
    useEffect(() => {
        if (editing) {
            titleRef.current?.focus();
            titleRef.current?.select();
        }
    }, [editing]);
    useEffect(() => {
        if (!editing && shouldRestoreEditFocusRef.current) {
            shouldRestoreEditFocusRef.current = false;
            editButtonRef.current?.focus();
        }
    }, [editing]);
    useEffect(() => {
        const dialog = tabListRef.current?.closest("[role=\"dialog\"]");
        const panel = dialog?.querySelector<HTMLElement>("[role=\"tabpanel\"]");
        if (!panel) return;
        panel.id = DRAWER_PANEL_ID;
        panel.setAttribute("aria-labelledby", `task-drawer-tab-${tab}`);
        return () => {
            if (panel.id === DRAWER_PANEL_ID) {
                panel.removeAttribute("id");
                panel.removeAttribute("aria-labelledby");
            }
        };
    }, [tab]);

    const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, value: TaskDrawerTab) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const currentIndex = DRAWER_TABS.indexOf(value);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex = (currentIndex + direction + DRAWER_TABS.length) % DRAWER_TABS.length;
        const nextTab = DRAWER_TABS[nextIndex];
        onTabChange(nextTab);
        window.requestAnimationFrame(() => document.getElementById(`task-drawer-tab-${nextTab}`)?.focus());
    };

    const startEditing = () => setEditing(true);
    const stopEditing = () => {
        shouldRestoreEditFocusRef.current = true;
        setEditing(false);
    };
    const cancel = () => {
        setTitle(task.title);
        stopEditing();
    };
    const save = async () => {
        const next = title.trim();
        if (!next || next === task.title) {
            cancel();
            return;
        }
        setSaving(true);
        try {
            await onUpdate({ title: next });
            stopEditing();
        } catch {
            cancel();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="sticky top-0 z-10 border-b border-border bg-background px-4 pb-0 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
            <div className="pr-8">
                <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    {task.project && <span className="truncate">{task.project.name}</span>}
                    {task.parents.map((parent) => <span key={parent.id} className="flex min-w-0 items-center gap-1"><span>/</span><span className="truncate">{parent.title}</span></span>)}
                    <span className="flex items-center gap-1"><span>/</span><span className="truncate text-foreground">{task.taskKey || "Task"}</span></span>
                </div>
                <div className="mt-2 flex items-start gap-2">
                    {editing ? (
                        <input
                            ref={titleRef}
                            value={title}
                            disabled={saving}
                            onChange={(event) => setTitle(event.target.value)}
                            onBlur={() => void save()}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") { event.preventDefault(); void save(); }
                                if (event.key === "Escape") { event.preventDefault(); cancel(); }
                            }}
                            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-lg font-semibold outline-none transition-[border-color,box-shadow] duration-150 focus:ring-2 focus:ring-ring"
                            aria-label="Edit task title"
                        />
                    ) : (
                        <SheetTitle onDoubleClick={startEditing} className="min-w-0 flex-1 cursor-text truncate text-lg font-semibold" title="Double-click or use Edit title">
                            {task.title}
                        </SheetTitle>
                    )}
                    {!editing && (
                        <button
                            ref={editButtonRef}
                            type="button"
                            onClick={startEditing}
                            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            aria-label="Edit title"
                            title="Edit title"
                        >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                    )}
                    <button type="button" onClick={onCopyLink} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground" aria-label="Copy task link" title="Copy task link"><Clipboard className="h-4 w-4" /></button>
                    <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground" aria-label="Close task drawer"><X className="h-4 w-4" /></button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="relative">
                    <StatusIcon className="pointer-events-none absolute left-2 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2" aria-hidden="true" />
                    <select value={task.status} onChange={(event) => void onUpdate({ status: event.target.value })} className={cn("h-9 rounded-full border bg-background pl-7 pr-2 text-xs font-medium outline-none transition-[border-color,box-shadow] duration-150 focus:ring-2 focus:ring-ring", statusClass(task.status as TaskStatus))} aria-label="Task status">
                        {STATUS_OPTIONS.map((value) => <option key={value} value={value}>{label(value)}</option>)}
                    </select>
                </div>
                <div className="relative">
                    <ArrowUp className={cn("pointer-events-none absolute left-2 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2", priorityRotation)} aria-hidden="true" />
                    <select value={task.priority} onChange={(event) => void onUpdate({ priority: event.target.value })} className={cn("h-9 rounded-full border bg-background pl-7 pr-2 text-xs font-medium outline-none transition-[border-color,box-shadow] duration-150 focus:ring-2 focus:ring-ring", priorityClass(task.priority as Priority))} aria-label="Task priority">
                        {PRIORITY_OPTIONS.map((value) => <option key={value} value={value}>{label(value)}</option>)}
                    </select>
                </div>
                    <span className="ml-auto flex items-center gap-1">
                        <button type="button" disabled={position <= 1} onClick={onPrevious} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous task"><ChevronLeft className="h-4 w-4" /></button>
                        <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">{position > 0 ? `${position} of ${total}` : "Not in list"}</span>
                        <button type="button" disabled={position <= 0 || position >= total} onClick={onNext} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next task"><ChevronRight className="h-4 w-4" /></button>
                    </span>
                </div>
            </div>
            <nav ref={tabListRef} className="mt-3 flex gap-1" aria-label="Task drawer tabs" role="tablist">
                {DRAWER_TABS.map((value) => (
                    <button
                        key={value}
                        id={`task-drawer-tab-${value}`}
                        type="button"
                        role="tab"
                        aria-controls={DRAWER_PANEL_ID}
                        aria-selected={tab === value}
                        tabIndex={tab === value ? 0 : -1}
                        onClick={() => onTabChange(value)}
                        onKeyDown={(event) => handleTabKeyDown(event, value)}
                        className={cn("min-h-11 flex-1 border-b-2 px-3 py-2 text-sm font-medium capitalize motion-safe:transition-[border-color,color] motion-safe:duration-200 motion-reduce:transition-none", tab === value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
                    >
                        {value}
                    </button>
                ))}
            </nav>
        </div>
    );
}
