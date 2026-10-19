"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    MouseEvent as ReactMouseEvent,
} from "react";
import { ArrowUp, CheckCircle2, Circle, Clock3, PauseCircle, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { dueClass, priorityClass, statusClass } from "@/lib/ui/status-tokens";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { TaskGridAssignment, TaskGridRow, TaskGridUser, GridColumnDefinition } from "./grid-types";
import { TimerCell } from "./TimerCell";
import { useGridKeyboard } from "./useGridKeyboard";
import type { SelectionModifiers } from "./selection";

export interface TaskRowProps {
    row: TaskGridRow;
    rowIds: readonly string[];
    columns: readonly GridColumnDefinition[];
    gridTemplateColumns: string;
    minWidth: number;
    selected: boolean;
    tabIndex: number;
    onFocusRow: (rowId: string) => void;
    onToggleSelected: (rowId: string, modifiers?: SelectionModifiers) => void;
    onSelectRow: (rowId: string, modifiers: SelectionModifiers) => void;
    onSaveTitle: (id: string, title: string) => Promise<void>;
}

function humanize(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
}

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

function initials(user: TaskGridUser): string {
    const label = user.name ?? user.email ?? "?";
    return label
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("") || "?";
}

function assignmentUser(assignment: TaskGridAssignment): TaskGridUser | null {
    return assignment.user;
}

function progressForRow(row: TaskGridRow): number {
    const direct = row.progress ?? row.manualProgress;
    if (direct != null && Number.isFinite(direct)) return Math.max(0, Math.min(100, direct));
    if (row.subtaskCount && row.subtaskCount > 0 && row.completedSubtasks != null) {
        return Math.round((row.completedSubtasks / row.subtaskCount) * 100);
    }
    return 0;
}

function formatDueDate(value: TaskGridRow["dueDate"]): string {
    if (!value) return "No due date";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No due date";
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function formatMinutes(minutes: number | null): string {
    if (!minutes || minutes <= 0) return "—";
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (hours === 0) return `${remainder}m`;
    if (remainder === 0) return `${hours}h`;
    return `${hours}h ${remainder}m`;
}

function modifiersFromEvent(event: Pick<ReactMouseEvent, "shiftKey" | "ctrlKey" | "metaKey">): SelectionModifiers {
    return {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
    };
}

export const TaskRow = memo(function TaskRow({
    row,
    rowIds,
    columns,
    gridTemplateColumns,
    minWidth,
    selected,
    tabIndex,
    onFocusRow,
    onToggleSelected,
    onSelectRow,
    onSaveTitle,
}: TaskRowProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const titleInputRef = useRef<HTMLInputElement>(null);
    const [editing, setEditing] = useState(false);
    const [draftTitle, setDraftTitle] = useState(row.title);
    const [saving, setSaving] = useState(false);
    const progress = progressForRow(row);
    const dueToken = row.dueDate ? dueClass(row.dueDate) : "";
    const StatusIcon = STATUS_ICONS[row.status] ?? Circle;
    const priorityRotation = priorityIconRotation(row.priority);

    useEffect(() => {
        if (!editing) setDraftTitle(row.title);
    }, [editing, row.title]);

    useEffect(() => {
        if (editing) {
            titleInputRef.current?.focus();
            titleInputRef.current?.select();
        }
    }, [editing]);

    const openTask = useCallback(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("task", row.id);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, [pathname, router, row.id, searchParams]);

    const startEditing = useCallback(() => {
        setDraftTitle(row.title);
        setEditing(true);
    }, [row.title]);

    const cancelEditing = useCallback(() => {
        setDraftTitle(row.title);
        setEditing(false);
    }, [row.title]);

    const saveTitle = useCallback(async () => {
        const nextTitle = draftTitle.trim();
        if (!nextTitle || nextTitle === row.title) {
            cancelEditing();
            return;
        }
        setSaving(true);
        try {
            await onSaveTitle(row.id, nextTitle);
            setEditing(false);
        } catch {
            setDraftTitle(row.title);
        } finally {
            setSaving(false);
        }
    }, [cancelEditing, draftTitle, onSaveTitle, row.id, row.title]);

    const { onKeyDown } = useGridKeyboard({
        rowId: row.id,
        rowIds,
        onOpen: openTask,
        onToggleSelection: () => onToggleSelected(row.id),
        onStartEdit: startEditing,
        onCancelEdit: cancelEditing,
        onFocusRow,
    });

    const onRowClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        const modifiers = modifiersFromEvent(event);
        if (modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey) {
            event.preventDefault();
            event.stopPropagation();
            onSelectRow(row.id, modifiers);
            return;
        }
        openTask();
    }, [onSelectRow, openTask, row.id]);

    const rowStyle = {
        gridTemplateColumns,
        minWidth: `${minWidth}px`,
        "--grid-key-left": "0px",
        "--grid-key-width": "var(--col-key-width)",
    } as CSSProperties;

    const renderCell = (column: GridColumnDefinition) => {
        switch (column.id) {
            case "key":
                return (
                    <div
                        key={column.id}
                        role="gridcell"
                        className="sticky z-10 flex h-10 min-w-0 items-center gap-2 border-r border-border/60 bg-background/95 px-3 backdrop-blur"
                        style={{ left: "var(--grid-key-left)" }}
                    >
                        <input
                            type="checkbox"
                            checked={selected}
                            aria-label={`Select ${row.title}`}
                            onChange={() => undefined}
                            onClick={(event) => {
                                event.stopPropagation();
                                onToggleSelected(row.id, modifiersFromEvent(event));
                            }}
                            className="h-4 w-4 shrink-0 rounded border-input accent-primary"
                        />
                        <span className="truncate font-mono text-xs text-muted-foreground">{row.taskKey ?? "—"}</span>
                    </div>
                );
            case "title":
                return (
                    <div
                        key={column.id}
                        role="gridcell"
                        className="sticky z-10 flex h-10 min-w-0 items-center border-r border-border/60 bg-background/95 px-3 backdrop-blur"
                        style={{ left: "var(--grid-key-width)" }}
                        onDoubleClick={(event) => {
                            event.stopPropagation();
                            startEditing();
                        }}
                    >
                        {editing ? (
                            <input
                                ref={titleInputRef}
                                value={draftTitle}
                                disabled={saving}
                                aria-label="Edit task title"
                                onChange={(event) => setDraftTitle(event.target.value)}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={async (event: ReactKeyboardEvent<HTMLInputElement>) => {
                                    event.stopPropagation();
                                    if (event.nativeEvent.isComposing) return;
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        await saveTitle();
                                    } else if (event.key === "Escape") {
                                        event.preventDefault();
                                        cancelEditing();
                                    }
                                }}
                                className="h-7 w-full rounded-md border border-input bg-background px-2 text-sm outline-none ring-ring transition-[border-color,box-shadow] duration-150 focus:ring-2"
                            />
                        ) : (
                            <span className="truncate font-medium text-foreground" title={row.project?.name ?? undefined}>
                                {row.title}
                            </span>
                        )}
                    </div>
                );
            case "timer":
                return <TimerCell key={column.id} taskId={row.id} taskTitle={row.title} />;
            case "status":
                return (
                    <div key={column.id} role="gridcell" className="min-w-0 px-3">
                        <span className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", statusClass(row.status))}>
                            <StatusIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                            {humanize(row.status)}
                        </span>
                    </div>
                );
            case "priority":
                return (
                    <div key={column.id} role="gridcell" className="min-w-0 px-3">
                        <span className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", priorityClass(row.priority))}>
                            <ArrowUp className={cn("h-3 w-3 shrink-0", priorityRotation)} aria-hidden="true" />
                            {humanize(row.priority)}
                        </span>
                    </div>
                );
            case "assignees":
                return (
                    <div key={column.id} role="gridcell" className="min-w-0 px-3">
                        <div className="flex items-center -space-x-1.5" aria-label={`${row.assignments.length} assignee${row.assignments.length === 1 ? "" : "s"}`}>
                            {row.assignments.slice(0, 4).map((assignment, index) => {
                                const user = assignmentUser(assignment);
                                if (!user) return null;
                                return (
                                    <span
                                        key={user.id || `${row.id}-assignee-${index}`}
                                        title={user.name ?? user.email ?? "Assignee"}
                                        className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted text-[9px] font-semibold text-muted-foreground"
                                    >
                                        {user.image ?? user.imageUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={user.image ?? user.imageUrl ?? ""} alt="" className="h-full w-full object-cover" />
                                        ) : initials(user)}
                                    </span>
                                );
                            })}
                            {row.assignments.length > 4 && (
                                <span className="flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-background bg-muted px-1 text-[9px] font-semibold text-muted-foreground">
                                    +{row.assignments.length - 4}
                                </span>
                            )}
                        </div>
                    </div>
                );
            case "dueDate":
                return (
                    <div key={column.id} role="gridcell" className="min-w-0 px-3">
                        <span className={cn("truncate text-xs", dueToken || "text-muted-foreground")}>
                            {formatDueDate(row.dueDate)}
                        </span>
                    </div>
                );
            case "progress":
                return (
                    <div key={column.id} role="gridcell" className="flex min-w-0 items-center gap-2 px-3">
                        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                            <span className="block h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                        </span>
                        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{progress}%</span>
                    </div>
                );
            case "estimate":
                return (
                    <div key={column.id} role="gridcell" className="truncate px-3 text-xs tabular-nums text-muted-foreground">
                        {formatMinutes(row.estimateMinutes)}
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div
            role="row"
            data-grid-row
            data-grid-row-id={row.id}
            tabIndex={tabIndex}
            aria-selected={selected}
            onFocus={() => onFocusRow(row.id)}
            onKeyDown={onKeyDown}
            onClick={onRowClick}
            style={rowStyle}
            className="grid h-10 items-center border-b border-border/60 text-sm outline-none transition-colors duration-150 hover:bg-muted/40 focus-visible:z-30 focus-visible:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
            {columns.map(renderCell)}
        </div>
    );
});
