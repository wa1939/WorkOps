"use client";

import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { ColumnResize, clampColumnWidth } from "./column-resize";
import type { GridColumnDefinition } from "./grid-types";

export interface GridColumnProps {
    column: GridColumnDefinition;
    width: number;
    onWidthChange: (columnId: GridColumnDefinition["id"], width: number) => void;
}

export function GridColumn({ column, width, onWidthChange }: GridColumnProps) {
    const {
        attributes,
        listeners,
        isDragging,
        setActivatorNodeRef,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: column.id, disabled: column.sticky === true });
    const stickyStyle: CSSProperties | undefined = column.id === "key"
        ? { left: 0 }
        : column.id === "title"
            ? { left: "var(--col-key-width)" }
            : undefined;
    const widthPx = clampColumnWidth(width);
    const dndStyle: CSSProperties = {
        ...stickyStyle,
        width: "var(--col-width)",
        minWidth: "var(--col-width)",
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
    };

    return (
        <div
            ref={setNodeRef}
            role="columnheader"
            className={cn(
                "relative flex h-9 items-center border-b bg-muted/70 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                column.sticky && "sticky z-20",
                isDragging && "z-40 opacity-80 shadow-lg",
            )}
            style={{ ...dndStyle, "--col-width": `${widthPx}px` } as CSSProperties}
        >
            <button
                ref={setActivatorNodeRef}
                type="button"
                aria-label={column.sticky ? column.label : `Reorder ${column.label} column`}
                className={cn(
                    "min-w-0 flex-1 truncate text-left outline-none",
                    !column.sticky && "cursor-grab active:cursor-grabbing focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring",
                )}
                {...attributes}
                {...listeners}
            >
                {column.label}
            </button>
            <ColumnResize columnId={column.id} width={widthPx} onWidthChange={onWidthChange} />
        </div>
    );
}
