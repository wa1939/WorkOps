import type {
    GridColumnId,
    GridColumnDefinition,
} from "./grid-types";

export const GRID_COLUMN_WIDTHS = {
    key: "104px",
    title: "300px",
    timer: "90px",
    status: "120px",
    priority: "110px",
    assignees: "180px",
    dueDate: "128px",
    progress: "140px",
    estimate: "110px",
} as const satisfies Record<GridColumnId, string>;

export const GRID_TEMPLATE_COLUMNS = Object.values(GRID_COLUMN_WIDTHS).join(" ");

export const GRID_COLUMNS: readonly GridColumnDefinition[] = [
    { id: "key", label: "Key", width: GRID_COLUMN_WIDTHS.key, sticky: true },
    { id: "title", label: "Task", width: GRID_COLUMN_WIDTHS.title, sticky: true },
    { id: "timer", label: "Timer", width: GRID_COLUMN_WIDTHS.timer, defaultHidden: true },
    { id: "status", label: "Status", width: GRID_COLUMN_WIDTHS.status },
    { id: "priority", label: "Priority", width: GRID_COLUMN_WIDTHS.priority },
    { id: "assignees", label: "Assignees", width: GRID_COLUMN_WIDTHS.assignees },
    { id: "dueDate", label: "Due", width: GRID_COLUMN_WIDTHS.dueDate },
    { id: "progress", label: "Progress", width: GRID_COLUMN_WIDTHS.progress },
    { id: "estimate", label: "Estimate", width: GRID_COLUMN_WIDTHS.estimate },
];
