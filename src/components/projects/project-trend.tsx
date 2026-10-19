"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface ProjectTrendProps {
    weeks: { label: string; done: number }[];
}

export function ProjectTrend({ weeks }: ProjectTrendProps) {
    const total = weeks.reduce((sum, w) => sum + w.done, 0);

    return (
        <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
                {total} task{total === 1 ? "" : "s"} completed in the last {weeks.length} weeks
            </p>
            <div className="h-40 w-full">
                <ResponsiveContainer>
                    <BarChart data={weeks} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                        <XAxis dataKey="label" fontSize={10} tickMargin={6} />
                        <YAxis fontSize={10} allowDecimals={false} width={28} />
                        <Tooltip
                            cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                            contentStyle={{
                                background: "hsl(var(--popover))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "0.5rem",
                                fontSize: "12px",
                            }}
                            formatter={(value: number) => [`${value} done`, "Completed"]}
                        />
                        <Bar dataKey="done" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
