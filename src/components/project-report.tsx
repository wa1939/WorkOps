"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, differenceInDays } from "date-fns";

// Note: Since I cannot install Recharts easily and user wants visual, I will use CSS/SVG based simple charts if Recharts is not available.
// However, shadcn usually implies recharts. I'll stick to simple HTML/CSS bars for safety as I don't want to break build if Recharts is missing.
// Wait, I saw "Recharts" in my previous thought but maybe I should check if it's installed.
// "npm list recharts"
// But for now I'll execute the safer option: manual charts or just stats cards.

interface Task {
    id: string;
    status: string;
    priority: string;
    effortHours: number | null;
    assignments: { user: { name: string } }[];
}

interface ProjectReportProps {
    tasks: Task[];
}

export function ProjectReport({ tasks }: ProjectReportProps) {
    // Calculate stats
    const total = tasks.length;
    const byStatus = tasks.reduce((acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const byPriority = tasks.reduce((acc, t) => {
        acc[t.priority] = (acc[t.priority] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const totalEffort = tasks.reduce((sum, t) => sum + (t.effortHours || 0), 0);

    // Status colors
    const colors: Record<string, string> = {
        TODO: "#64748b",
        DOING: "#3b82f6",
        BLOCKED: "#ef4444",
        WAITING: "#eab308",
        DONE: "#22c55e",
        CANCELED: "#9ca3af",
    };

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{total}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Completed</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">
                            {byStatus["DONE"] || 0}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {total > 0 ? Math.round(((byStatus["DONE"] || 0) / total) * 100) : 0}% completion rate
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Blocked/Waiting</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-yellow-600">
                            {(byStatus["BLOCKED"] || 0) + (byStatus["WAITING"] || 0)}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Total Effort</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalEffort}h</div>
                        <p className="text-xs text-muted-foreground">Estimated hours</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* Status Distribution */}
                <Card>
                    <CardHeader>
                        <CardTitle>Task Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {Object.entries(byStatus).map(([status, count]) => (
                                <div key={status} className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                        <span className="font-medium">{status}</span>
                                        <span className="text-muted-foreground">{count} ({Math.round((count / total) * 100)}%)</span>
                                    </div>
                                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                        <div
                                            className="h-full rounded-full"
                                            style={{
                                                width: `${(count / total) * 100}%`,
                                                backgroundColor: colors[status] || "#cbd5e1"
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Priority Distribution */}
                <Card>
                    <CardHeader>
                        <CardTitle>Task Priority</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {["URGENT", "HIGH", "MEDIUM", "LOW"].map((priority) => {
                                const count = byPriority[priority] || 0;
                                if (count === 0) return null;
                                return (
                                    <div key={priority} className="space-y-1">
                                        <div className="flex justify-between text-sm">
                                            <span className="font-medium">{priority}</span>
                                            <span className="text-muted-foreground">{count}</span>
                                        </div>
                                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-primary"
                                                style={{ width: `${(count / total) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
