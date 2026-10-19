"use client";

import {
    ResponsiveContainer,
    ComposedChart,
    Area,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ReferenceLine,
    ReferenceArea,
    CartesianGrid,
} from "recharts";

interface KpiUpdate {
    createdAt: Date | string;
    quarter?: string | null;
    value?: number | null;
    score?: number | null;
    achievementPercent?: number | null;
    note?: string | null;
}

interface KpiTrendChartProps {
    updates: KpiUpdate[];
    level1?: number | null;
    level2?: number | null;
    level3?: number | null;
    level4?: number | null;
    level5?: number | null;
    annualTarget?: number | null;
    unit?: string | null;
}

export function KpiTrendChart({
    updates,
    level1,
    level2,
    level3,
    level4,
    level5,
    annualTarget,
    unit,
}: KpiTrendChartProps) {
    // Prefer achievementPercent; render on 0-100 scale
    const usePercent = updates.some((u) => typeof u.achievementPercent === "number");
    const useScore = !usePercent && updates.some((u) => typeof u.score === "number");

    const data = [...updates]
        .reverse()
        .map((u) => {
            const rawValue = usePercent
                ? u.achievementPercent
                : useScore
                    ? u.score
                    : u.value;
            return {
                date: new Date(u.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
                quarter: u.quarter || "",
                value: rawValue ?? null,
                note: u.note ?? "",
            };
        })
        .filter((d) => typeof d.value === "number");

    if (data.length < 2) {
        return (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground italic">
                Log at least two updates to see the trend chart.
            </div>
        );
    }

    const yLabel = usePercent ? "% of target" : useScore ? "Score / 5" : unit || "value";
    const maxY = usePercent ? 100 : useScore ? 5 : Math.max(...data.map((d) => d.value as number)) * 1.1;

    const bandColor = "hsl(var(--primary))";
    // Threshold bands (only if the numbers are on the same scale as the data)
    const showBands = usePercent && [level1, level2, level3, level4, level5].every((v) => typeof v === "number");

    return (
        <div className="w-full h-64">
            <ResponsiveContainer>
                <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="date" fontSize={11} tickMargin={6} />
                    <YAxis fontSize={11} domain={[0, maxY]} label={{ value: yLabel, angle: -90, position: "insideLeft", offset: 12, style: { fontSize: 11 } }} />
                    <Tooltip
                        contentStyle={{
                            background: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "0.5rem",
                            fontSize: "12px",
                        }}
                        formatter={(value: number) => [
                            usePercent ? `${value.toFixed(1)}%` : useScore ? `${value.toFixed(1)} / 5` : `${value} ${unit || ""}`,
                            "Value",
                        ]}
                    />

                    {showBands && (
                        <>
                            <ReferenceArea y1={0} y2={level1 as number} fill={bandColor} fillOpacity={0.04} strokeOpacity={0} />
                            <ReferenceArea y1={level1 as number} y2={level2 as number} fill={bandColor} fillOpacity={0.08} strokeOpacity={0} />
                            <ReferenceArea y1={level2 as number} y2={level3 as number} fill={bandColor} fillOpacity={0.12} strokeOpacity={0} />
                            <ReferenceArea y1={level3 as number} y2={level4 as number} fill={bandColor} fillOpacity={0.18} strokeOpacity={0} />
                            <ReferenceArea y1={level4 as number} y2={level5 as number} fill={bandColor} fillOpacity={0.24} strokeOpacity={0} />
                        </>
                    )}

                    {!usePercent && !useScore && annualTarget && (
                        <ReferenceLine y={annualTarget} stroke="hsl(var(--primary))" strokeDasharray="4 4" label={{ value: `Target ${annualTarget}${unit ? " " + unit : ""}`, fontSize: 10, fill: "hsl(var(--primary))" }} />
                    )}
                    {usePercent && (
                        <ReferenceLine y={100} stroke="hsl(var(--primary))" strokeDasharray="4 4" label={{ value: "Target 100%", fontSize: 10, fill: "hsl(var(--primary))" }} />
                    )}

                    <Area
                        type="monotone"
                        dataKey="value"
                        stroke="none"
                        fill={bandColor}
                        fillOpacity={0.12}
                    />
                    <Line
                        type="monotone"
                        dataKey="value"
                        stroke={bandColor}
                        strokeWidth={2.5}
                        dot={{ r: 4, fill: bandColor }}
                        activeDot={{ r: 5 }}
                    />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}
