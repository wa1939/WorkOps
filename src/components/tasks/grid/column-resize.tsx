"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import type { GridColumnId } from "./grid-types";

export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 480;
export const COLUMN_RESIZE_KEYBOARD_STEP = 8;
export const COLUMN_RESIZE_KEYBOARD_LARGE_STEP = 32;

/** Clamp a column width to the grid's supported range. */
export function clampColumnWidth(
    value: number,
    min = MIN_COLUMN_WIDTH,
    max = MAX_COLUMN_WIDTH,
): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
}

export function resizeColumnWidth(startWidth: number, startX: number, currentX: number): number {
    return clampColumnWidth(startWidth + currentX - startX);
}

export interface ColumnResizeProps {
    columnId: GridColumnId;
    width: number;
    onWidthChange: (columnId: GridColumnId, width: number) => void;
}

interface PointerDragState {
    startX: number;
    startWidth: number;
}

function eventModifiers(event: ReactKeyboardEvent<HTMLDivElement>): number {
    return event.shiftKey
        ? COLUMN_RESIZE_KEYBOARD_LARGE_STEP
        : COLUMN_RESIZE_KEYBOARD_STEP;
}

export function ColumnResize({ columnId, width, onWidthChange }: ColumnResizeProps) {
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef<PointerDragState | null>(null);

    const stopDragging = useCallback(() => {
        dragRef.current = null;
        setDragging(false);
    }, []);

    useEffect(() => {
        if (!dragging) return undefined;

        const onPointerMove = (event: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            onWidthChange(columnId, resizeColumnWidth(drag.startWidth, drag.startX, event.clientX));
        };
        const onPointerUp = () => stopDragging();

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
        return () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerUp);
        };
    }, [columnId, dragging, onWidthChange, stopDragging]);

    const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = { startX: event.clientX, startWidth: width };
        setDragging(true);
    }, [width]);

    const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
        const step = eventModifiers(event);
        if (event.key === "ArrowRight") {
            event.preventDefault();
            onWidthChange(columnId, clampColumnWidth(width + step));
        } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            onWidthChange(columnId, clampColumnWidth(width - step));
        } else if (event.key === "Home") {
            event.preventDefault();
            onWidthChange(columnId, MIN_COLUMN_WIDTH);
        } else if (event.key === "End") {
            event.preventDefault();
            onWidthChange(columnId, MAX_COLUMN_WIDTH);
        }
    }, [columnId, onWidthChange, width]);

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${columnId} column`}
            aria-valuemin={MIN_COLUMN_WIDTH}
            aria-valuemax={MAX_COLUMN_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
            onDoubleClick={() => onWidthChange(columnId, clampColumnWidth(width))}
            className={cn(
                "absolute inset-y-0 right-0 z-30 flex w-2 translate-x-1/2 cursor-col-resize touch-none items-center justify-center outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                dragging && "bg-primary/10",
            )}
        >
            <span aria-hidden="true" className={cn("h-5 w-px bg-border", dragging && "bg-primary")} />
        </div>
    );
}
