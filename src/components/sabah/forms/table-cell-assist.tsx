"use client";

import React from "react";

/**
 * Table-cell-scoped assistance: targets a cell by row/column/entity IDs —
 * never by visible position alone.
 */
export function dispatchTableCellAssist(target: { entityId: string; columnKey: string }) {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("sabah:table-cell-assist", { detail: target }));
}

export function TableCellAssist({
    entityId,
    columnKey,
    onAssist = dispatchTableCellAssist,
}: {
    entityId: string;
    columnKey: string;
    onAssist?: (target: { entityId: string; columnKey: string }) => void;
}) {
    return (
        <button
            type="button"
            aria-label={`Sabah assistance for ${columnKey} of ${entityId}`}
            onClick={() => onAssist?.({ entityId, columnKey })}
            className="inline-flex h-5 w-5 items-center justify-center rounded border border-border/60 text-[9px] font-bold text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary group-hover/table-row:opacity-100"
        >
            S
        </button>
    );
}
