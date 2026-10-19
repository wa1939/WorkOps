"use client";

import { differenceInCalendarDays } from "date-fns";
import { cn } from "@/lib/utils";
import { buildRuler, pxPerDay, type TimelineZoom } from "@/lib/timeline/ruler";

type DateRulerProps = {
    from: Date;
    to: Date;
    zoom: TimelineZoom;
    labelWidth: number;
};

export function DateRuler({ from, to, zoom, labelWidth }: DateRulerProps) {
    const ruler = buildRuler(from, to, zoom);
    const dayWidth = pxPerDay(zoom);

    return (
        <div
            className="flex min-w-max border-b bg-muted/20 text-xs text-muted-foreground"
            style={{ minWidth: labelWidth + ruler.totalWidth }}
        >
            <div
                className="sticky left-0 z-20 flex shrink-0 items-center border-r bg-card px-3 py-2 font-medium text-foreground"
                style={{ width: labelWidth }}
            >
                Project
            </div>
            <div className="flex shrink-0" style={{ width: ruler.totalWidth }}>
                {ruler.columns.map((column) => {
                    const width = differenceInCalendarDays(column.end, column.start) * dayWidth;
                    return (
                        <div
                            key={`${column.start.getTime()}-${column.end.getTime()}`}
                            className={cn(
                                "flex h-10 shrink-0 items-center justify-center overflow-hidden border-r px-1 text-center",
                                column.isWeekend && "bg-muted/60",
                            )}
                            style={{ width }}
                            title={column.label}
                        >
                            <span className="truncate">{column.label}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
