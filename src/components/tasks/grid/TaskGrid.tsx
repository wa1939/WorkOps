"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ListTodo } from "lucide-react";
import {
    closestCenter,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    arrayMove,
    horizontalListSortingStrategy,
    SortableContext,
    sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dueDateSemantics } from "@/lib/ui/status-tokens";
import { cn } from "@/lib/utils";
import { GRID_COLUMNS } from "./grid-columns";
import { GridColumn } from "./GridColumn";
import { GroupHeader } from "./GroupHeader";
import { TaskRow } from "./TaskRow";
import type {
    GridColumnDefinition,
    GridColumnId,
    GridGroupBy,
    TaskGridGroup,
    TaskGridRow,
    TaskGridUser,
    TaskGridFilters,
} from "./grid-types";
import { TaskDrawer } from "../drawer/TaskDrawer";
import { TaskDrawerListProvider } from "../drawer/useTaskDrawer";
import type { SelectionModifiers } from "./selection";
import { useTaskGrid } from "./useTaskGrid";
import { clampColumnWidth } from "./column-resize";
import { BulkBar } from "./BulkBar";
import { taskGridWindow } from "./grid-window";



const GRID_PREFERENCES_VERSION = 1 as const;
const GRID_PREFERENCES_KEY = "departmenthub:tasks-grid-preferences-v1";

type GridPreferences = {
    version: typeof GRID_PREFERENCES_VERSION;
    widths: Partial<Record<GridColumnId, number>>;
    order: GridColumnId[];
    hidden: GridColumnId[];
};

type GridPreferenceStyle = CSSProperties & Record<string, string>;

const ALL_COLUMN_IDS = GRID_COLUMNS.map((column) => column.id);
const COLUMN_BY_ID = Object.fromEntries(
    GRID_COLUMNS.map((column) => [column.id, column]),
) as Record<GridColumnId, GridColumnDefinition>;
const STICKY_COLUMN_IDS = GRID_COLUMNS.filter((column) => column.sticky).map((column) => column.id);
const DEFAULT_COLUMN_WIDTHS = GRID_COLUMNS.reduce<Record<GridColumnId, number>>((result, column) => {
    result[column.id] = clampColumnWidth(Number.parseFloat(column.width));
    return result;
}, {} as Record<GridColumnId, number>);

const GROUP_OPTIONS: Array<{ value: GridGroupBy; label: string }> = [
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "assignee", label: "Assignee" },
    { value: "none", label: "No grouping" },
];

interface RenderGroup extends TaskGridGroup {
    rows: TaskGridRow[];
}

function isGridColumnId(value: unknown): value is GridColumnId {
    return typeof value === "string" && ALL_COLUMN_IDS.includes(value as GridColumnId);
}

function isStickyColumn(id: GridColumnId): boolean {
    return COLUMN_BY_ID[id].sticky === true;
}

function defaultGridPreferences(): GridPreferences {
    return {
        version: GRID_PREFERENCES_VERSION,
        widths: { ...DEFAULT_COLUMN_WIDTHS },
        order: [...ALL_COLUMN_IDS],
        hidden: GRID_COLUMNS.filter((column) => column.defaultHidden === true).map((column) => column.id),
    };
}

function normalizeOrder(value: unknown): GridColumnId[] {
    const stored = Array.isArray(value) ? value.filter(isGridColumnId) : [];
    const unique = Array.from(new Set(stored));
    const present = new Set(unique);
    return [
        ...STICKY_COLUMN_IDS,
        ...unique.filter((id) => !isStickyColumn(id)),
        ...ALL_COLUMN_IDS.filter((id) => !present.has(id)),
    ];
}

function normalizeHidden(value: unknown): GridColumnId[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter(isGridColumnId).filter((id) => !isStickyColumn(id))));
}

function readGridPreferences(storageKey: string): GridPreferences {
    const fallback = defaultGridPreferences();
    if (typeof window === "undefined") return fallback;

    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw) as {
            version?: unknown;
            widths?: unknown;
            order?: unknown;
            hidden?: unknown;
        };
        if (parsed.version !== GRID_PREFERENCES_VERSION) return fallback;

        const widths = { ...fallback.widths };
        if (parsed.widths && typeof parsed.widths === "object") {
            Object.entries(parsed.widths).forEach(([id, value]) => {
                if (isGridColumnId(id) && typeof value === "number") {
                    widths[id] = clampColumnWidth(value);
                }
            });
        }
        return {
            version: GRID_PREFERENCES_VERSION,
            widths,
            order: normalizeOrder(parsed.order),
            hidden: normalizeHidden(parsed.hidden),
        };
    } catch {
        return fallback;
    }
}

function useGridPreferences(storageKey: string) {
    const [preferences, setPreferences] = useState<GridPreferences>(defaultGridPreferences);
    const [hydratedKey, setHydratedKey] = useState<string | null>(null);

    useEffect(() => {
        setPreferences(readGridPreferences(storageKey));
        setHydratedKey(storageKey);
    }, [storageKey]);

    useEffect(() => {
        if (hydratedKey !== storageKey || typeof window === "undefined") return;
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(preferences));
        } catch {
            // Private browsing and storage quotas should not break the grid.
        }
    }, [hydratedKey, preferences, storageKey]);

    const setWidth = useCallback((id: GridColumnId, width: number) => {
        setPreferences((current) => ({
            ...current,
            widths: { ...current.widths, [id]: clampColumnWidth(width) },
        }));
    }, []);

    const setVisibility = useCallback((id: GridColumnId, visible: boolean) => {
        if (isStickyColumn(id)) return;
        setPreferences((current) => {
            const hidden = new Set(current.hidden);
            if (visible) hidden.delete(id);
            else hidden.add(id);
            return { ...current, hidden: Array.from(hidden) };
        });
    }, []);

    const reorder = useCallback((activeId: GridColumnId, overId: GridColumnId) => {
        if (activeId === overId || isStickyColumn(activeId) || isStickyColumn(overId)) return;
        setPreferences((current) => {
            const order = normalizeOrder(current.order);
            const hidden = new Set(current.hidden);
            const visibleIds = order.filter((id) => !isStickyColumn(id) && !hidden.has(id));
            const fromIndex = visibleIds.indexOf(activeId);
            const toIndex = visibleIds.indexOf(overId);
            if (fromIndex < 0 || toIndex < 0) return current;
            const nextVisibleIds = arrayMove(visibleIds, fromIndex, toIndex);
            const hiddenIds = order.filter((id) => !isStickyColumn(id) && hidden.has(id));
            return {
                ...current,
                order: [...STICKY_COLUMN_IDS, ...nextVisibleIds, ...hiddenIds],
            };
        });
    }, []);

    return { preferences, setWidth, setVisibility, reorder };
}

function groupKeyForRow(row: TaskGridRow, groupBy: GridGroupBy): string[] {
    if (groupBy === "status") return [row.status];
    if (groupBy === "priority") return [row.priority];
    if (groupBy === "assignee") {
        // Mirror the server: a task appears under EVERY assignee group (plus
        // "unassigned" when it has none), so group headers and select-all
        // stay consistent with server-side grouping.
        const ids = row.assignments.map((assignment) => assignment.user?.id).filter((id): id is string => Boolean(id));
        return ids.length > 0 ? Array.from(new Set(ids)) : ["unassigned"];
    }
    return ["all"];
}

function groupLabelForKey(key: string, groupBy: GridGroupBy): string {
    if (groupBy === "none") return "All tasks";
    if (key === "unassigned") return "Unassigned";
    return key.charAt(0) + key.slice(1).toLowerCase().replaceAll("_", " ");
}

function deriveGroup(key: string, rows: TaskGridRow[], groupBy: GridGroupBy): RenderGroup {
    const sampleAvatars = new Map<string, TaskGridUser>();
    rows.forEach((row) => row.assignments.forEach(({ user }) => {
        if (user) sampleAvatars.set(user.id, user);
    }));
    return {
        key,
        label: groupLabelForKey(key, groupBy),
        count: rows.length,
        doneCount: rows.filter((row) => row.status === "DONE").length,
        overdueCount: rows.filter((row) => (
            row.dueDate != null && dueDateSemantics(row.dueDate) === "overdue" && row.status !== "DONE"
        )).length,
        estimateMinutesSum: rows.reduce((sum, row) => sum + (row.estimateMinutes ?? 0), 0),
        sampleAvatars: Array.from(sampleAvatars.values()).slice(0, 5),
        rows,
    };
}

export function TaskGrid({ filters }: { filters?: TaskGridFilters } = {}) {
    // Session context is not mounted app-wide (no SessionProvider); grid
    // preferences stay per-browser instead of per-user to avoid a crash here.
    const storageKey = GRID_PREFERENCES_KEY;
    const { preferences, setWidth, setVisibility, reorder } = useGridPreferences(storageKey);
    const {
        rows,
        groups,
        groupBy,
        setGroupBy,
        loading,
        loadingMore,
        error,
        isEmpty,
        hasMore,
        loadMore,
        refresh,
        updateTaskLocal,
        selectedIds,
        toggleSelection,
        selectRow,
        selectGroup,
        clearSelection,
    } = useTaskGrid({ filters });
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [windowPage, setWindowPage] = useState(0);
    const filtersKey = JSON.stringify(filters ?? {});
    useEffect(() => setWindowPage(0), [filtersKey]);
    const rowWindow = useMemo(() => taskGridWindow(rows, windowPage), [rows, windowPage]);
    const visibleRows = rowWindow.rows;
    const rowIds = useMemo(() => visibleRows.map((row) => row.id), [visibleRows]);
    const rowIdsKey = rowIds.join("|");
    const [focusedRowId, setFocusedRowId] = useState<string | null>(rowIds[0] ?? null);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const widths = useMemo(() => {
        const result = { ...DEFAULT_COLUMN_WIDTHS };
        ALL_COLUMN_IDS.forEach((id) => {
            result[id] = clampColumnWidth(preferences.widths[id] ?? DEFAULT_COLUMN_WIDTHS[id]);
        });
        return result;
    }, [preferences.widths]);

    const hiddenColumns = useMemo(() => new Set(preferences.hidden), [preferences.hidden]);
    const visibleColumns = useMemo(() => normalizeOrder(preferences.order)
        .filter((id) => !hiddenColumns.has(id))
        .map((id) => ({ ...COLUMN_BY_ID[id], width: `${widths[id]}px` })), [hiddenColumns, preferences.order, widths]);
    const gridTemplateColumns = useMemo(
        () => visibleColumns.map((column) => `var(--col-${column.id}-width)`).join(" "),
        [visibleColumns],
    );
    const minWidth = useMemo(
        () => visibleColumns.reduce((total, column) => total + widths[column.id], 0),
        [visibleColumns, widths],
    );
    const gridVariables = useMemo<GridPreferenceStyle>(() => {
        const result: GridPreferenceStyle = {};
        ALL_COLUMN_IDS.forEach((id) => {
            result[`--col-${id}-width`] = `${widths[id]}px`;
        });
        return result;
    }, [widths]);

    useEffect(() => {
        setFocusedRowId((current) => current && rowIds.includes(current) ? current : rowIds[0] ?? null);
    }, [rowIdsKey, rowIds]);

    useEffect(() => {
        setCollapsedGroups(new Set());
    }, [groupBy]);

    const renderGroups = useMemo<RenderGroup[]>(() => {
        if (visibleRows.length === 0) return [];
        if (groupBy === "none") {
            const group = groups[0];
            return [group
                ? { ...group, rows: visibleRows }
                : deriveGroup("all", visibleRows, groupBy)];
        }
        const buckets = new Map<string, TaskGridRow[]>();
        visibleRows.forEach((row) => {
            for (const key of groupKeyForRow(row, groupBy)) {
                const bucket = buckets.get(key) ?? [];
                bucket.push(row);
                buckets.set(key, bucket);
            }
        });

        const configuredGroups = groups.map((group) => ({
            ...group,
            rows: buckets.get(group.key) ?? [],
        }));
        const configuredKeys = new Set(configuredGroups.map((group) => group.key));
        const extraGroups = Array.from(buckets.entries())
            .filter(([key]) => !configuredKeys.has(key))
            .map(([key, bucket]) => deriveGroup(key, bucket, groupBy));

        if (configuredGroups.length === 0) {
            return Array.from(buckets.entries()).map(([key, bucket]) => deriveGroup(key, bucket, groupBy));
        }
        return [...configuredGroups, ...extraGroups];
    }, [groupBy, groups, visibleRows]);

    const toggleCollapsed = useCallback((key: string) => {
        setCollapsedGroups((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const handleColumnDragEnd = useCallback((event: DragEndEvent) => {
        if (!event.over) return;
        const activeId = String(event.active.id);
        const overId = String(event.over.id);
        if (isGridColumnId(activeId) && isGridColumnId(overId)) reorder(activeId, overId);
    }, [reorder]);

    const saveTitle = useCallback((id: string, title: string) => {
        return updateTaskLocal(id, { title });
    }, [updateTaskLocal]);

    const handleToggleSelected = useCallback((rowId: string, modifiers?: SelectionModifiers) => {
        toggleSelection(rowId, modifiers);
    }, [toggleSelection]);

    const handleSelectRow = useCallback((rowId: string, modifiers: SelectionModifiers) => {
        selectRow(rowId, modifiers);
    }, [selectRow]);

    return (
        <TaskDrawerListProvider ids={rowIds}>
            <section className="space-y-4 pb-20" aria-label="Task grid">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="min-w-0 basis-full sm:mr-auto sm:basis-auto">
                    {filters ? <h2 className="sr-only">Task results</h2> : <h1 className="truncate text-xl font-semibold tracking-tight">Tasks</h1>}
                    <p className="text-sm text-muted-foreground">{rows.length}{hasMore ? "+" : ""} tasks loaded</p>
                </div>

                {selectedIds.size > 0 && (
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                        {selectedIds.size} selected
                    </span>
                )}
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="min-h-11 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                        >
                            Columns
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56">
                        <div className="space-y-3">
                            <div>
                                <p className="text-sm font-medium">Visible columns</p>
                                <p className="text-xs text-muted-foreground">Key and Task stay pinned.</p>
                            </div>
                            <div className="space-y-2">
                                {GRID_COLUMNS.map((column) => {
                                    const visible = !hiddenColumns.has(column.id);
                                    return (
                                        <label key={column.id} className="flex items-center gap-2 text-sm">
                                            <Checkbox
                                                checked={visible}
                                                disabled={column.sticky === true}
                                                onCheckedChange={(checked) => setVisibility(column.id, checked === true)}
                                            />
                                            <span className={cn(column.sticky && "text-muted-foreground")}>{column.label}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>
                <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
                    <span className="hidden sm:inline">Group by</span>
                    <span className="sr-only sm:hidden">Group tasks by</span>
                    <select
                        value={groupBy}
                        aria-label="Group tasks by"
                        onChange={(event) => setGroupBy(event.target.value as GridGroupBy)}
                        className="h-11 max-w-[9rem] truncate rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                        {GROUP_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>
                {hasMore && (
                    <button
                        type="button"
                        disabled={loadingMore}
                        onClick={() => void loadMore()}
                        className="min-h-11 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {loadingMore ? "Loading…" : "Load more"}
                    </button>
                )}
            </div>

            {rowWindow.pages > 1 && (
                <nav aria-label="Loaded task pages" className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">Showing {rowWindow.start + 1}–{rowWindow.start + visibleRows.length} of {rows.length} loaded tasks</span>
                    <div className="flex items-center gap-2">
                        <button type="button" className="min-h-11 rounded-md border px-3 disabled:opacity-50" disabled={rowWindow.page === 0} onClick={() => setWindowPage(rowWindow.page - 1)}>Previous tasks</button>
                        <button type="button" className="min-h-11 rounded-md border px-3 disabled:opacity-50" disabled={rowWindow.page >= rowWindow.pages - 1} onClick={() => setWindowPage(rowWindow.page + 1)}>Next tasks</button>
                    </div>
                </nav>
            )}
            {error && (
                <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    <span>{error}</span>
                    <button type="button" onClick={refresh} className="font-medium underline underline-offset-2">Retry</button>
                </div>
            )}

            {loading && rows.length === 0 && (
                <div className="overflow-hidden rounded-lg border border-border">
                    {Array.from({ length: 6 }, (_, index) => (
                        <div key={index} className="h-10 border-b border-border/60 bg-muted/30 motion-safe:animate-pulse motion-reduce:animate-none motion-reduce:opacity-60" />
                    ))}
                </div>
            )}

            {isEmpty && (
                <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <ListTodo className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <p className="mt-3 font-medium">No tasks found</p>
                    <p className="mt-1 text-sm text-muted-foreground">Change the filters or create a task to get started.</p>
                </div>
            )}

            {(!loading && !isEmpty && rows.length > 0) && (
                <>
                    <p className="text-right text-xs text-muted-foreground md:hidden" aria-hidden="true">Swipe to see more columns →</p>
                    <div className="relative overflow-hidden rounded-lg border border-border">
                        <div className="overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch]">
                            <div
                                role="grid"
                                aria-rowcount={rows.length}
                                aria-colcount={visibleColumns.length}
                                style={{ ...gridVariables, minWidth: `${minWidth}px` } as CSSProperties}
                            >
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={handleColumnDragEnd}
                                >
                                    <SortableContext
                                        items={visibleColumns.map((column) => column.id)}
                                        strategy={horizontalListSortingStrategy}
                                    >
                                        <div
                                            role="row"
                                            style={{ gridTemplateColumns, minWidth: `${minWidth}px` }}
                                            className="grid"
                                        >
                                            {visibleColumns.map((column) => (
                                                <GridColumn
                                                    key={column.id}
                                                    column={column}
                                                    width={widths[column.id]}
                                                    onWidthChange={setWidth}
                                                />
                                            ))}
                                        </div>
                                    </SortableContext>
                                </DndContext>
                                {renderGroups.map((group) => {
                                    const isCollapsed = collapsedGroups.has(group.key);
                                    const groupRowIds = group.rows.map((row) => row.id);
                                    return (
                                        <div key={group.key}>
                                            <GroupHeader
                                                group={group}
                                                collapsed={isCollapsed}
                                                rowIds={groupRowIds}
                                                selectedIds={selectedIds}
                                                onToggle={() => toggleCollapsed(group.key)}
                                                onToggleSelectAll={() => selectGroup(group.key)}
                                            />
                                            {!isCollapsed && group.rows.map((row) => (
                                                <TaskRow
                                                    key={row.id}
                                                    row={row}
                                                    rowIds={rowIds}
                                                    columns={visibleColumns}
                                                    gridTemplateColumns={gridTemplateColumns}
                                                    minWidth={minWidth}
                                                    selected={selectedIds.has(row.id)}
                                                    tabIndex={focusedRowId === row.id ? 0 : -1}
                                                    onFocusRow={setFocusedRowId}
                                                    onToggleSelected={handleToggleSelected}
                                                    onSelectRow={handleSelectRow}
                                                    onSaveTitle={saveTitle}
                                                />
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background/90 to-transparent md:hidden" aria-hidden="true" />
                    </div>
                </>
            )}


            <BulkBar
                selectedIds={selectedIds}
                onRefresh={refresh}
                onClearSelection={clearSelection}
            />
            </section>
            <TaskDrawer />
        </TaskDrawerListProvider>
    );
}
