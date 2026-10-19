import { cn } from "@/lib/utils";

interface KpiSparklinePoint {
    createdAt: Date | string;
    value?: number | null;
    score?: number | null;
    achievementPercent?: number | null;
}

interface KpiSparklineProps {
    updates: KpiSparklinePoint[];
    width?: number;
    height?: number;
    className?: string;
}

/**
 * Compact SVG sparkline showing the KPI update trend. Prefers achievementPercent
 * (0-100), falls back to score (0-5), then value. No library dependency.
 */
export function KpiSparkline({ updates, width = 120, height = 32, className }: KpiSparklineProps) {
    if (!updates || updates.length < 2) {
        return (
            <div
                className={cn("text-[10px] text-muted-foreground/60 italic", className)}
                style={{ width, height }}
            >
                Not enough history yet
            </div>
        );
    }

    // Newest first from the query — reverse to chronological
    const points = [...updates].reverse().map((u) => {
        if (typeof u.achievementPercent === "number") return u.achievementPercent;
        if (typeof u.score === "number") return (u.score / 5) * 100;
        if (typeof u.value === "number") return u.value;
        return null;
    });

    const numeric = points.filter((p): p is number => typeof p === "number");
    if (numeric.length < 2) {
        return (
            <div
                className={cn("text-[10px] text-muted-foreground/60 italic", className)}
                style={{ width, height }}
            >
                Not enough history yet
            </div>
        );
    }

    const min = Math.min(...numeric);
    const max = Math.max(...numeric);
    const range = max - min || 1;
    const step = numeric.length > 1 ? width / (numeric.length - 1) : width;

    const coords = numeric.map((v, i) => {
        const x = i * step;
        const normalized = (v - min) / range;
        const y = height - normalized * (height - 4) - 2;
        return { x, y };
    });

    const pathD = coords
        .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
        .join(" ");

    const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

    const last = coords[coords.length - 1];
    const first = coords[0];
    const trendUp = last.y < first.y; // lower y = higher value

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className={cn("overflow-visible", className)}
            aria-label="KPI trend sparkline"
        >
            <defs>
                <linearGradient id="kpi-spark-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={areaD} fill="url(#kpi-spark-fill)" />
            <path
                d={pathD}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle
                cx={last.x}
                cy={last.y}
                r={2.5}
                fill={trendUp ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)"}
                stroke="hsl(var(--background))"
                strokeWidth="1"
            />
        </svg>
    );
}
