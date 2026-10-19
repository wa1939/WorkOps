"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { format, differenceInDays, addDays, getWeek } from "date-fns";

interface Task {
    id: string;
    title: string;
    status: string;
    startAt?: Date | string | null;
    dueAt?: Date | string | null;
    createdAt: Date | string;
    assignments: { user: { name: string } }[];
}

interface ProjectGanttProps {
    tasks: Task[];
    startDate?: Date | string | null;
    dueDate?: Date | string | null;
}

export function ProjectGantt({ tasks, startDate, dueDate }: ProjectGanttProps) {
    if (tasks.length === 0) {
        return (
            <div className="text-center py-12 text-muted-foreground border rounded-lg bg-muted/10">
                No tasks to display in Gantt chart
            </div>
        );
    }

    // Determine timeline range
    const taskDates = tasks.flatMap(t => [
        t.startAt ? new Date(t.startAt) : new Date(t.createdAt),
        t.dueAt ? new Date(t.dueAt) : new Date()
    ]);

    if (startDate) taskDates.push(new Date(startDate));
    if (dueDate) taskDates.push(new Date(dueDate));

    const minDate = new Date(Math.min(...taskDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...taskDates.map(d => d.getTime())));

    // Add buffer
    minDate.setDate(minDate.getDate() - 2);
    maxDate.setDate(maxDate.getDate() + 5);

    const totalDays = differenceInDays(maxDate, minDate) + 1;
    const dayWidth = 40; // px per day
    const chartWidth = totalDays * dayWidth;

    // Generate days header
    const days: Date[] = [];
    for (let i = 0; i < totalDays; i++) {
        days.push(addDays(minDate, i));
    }

    const getPosition = (date: Date | string) => {
        const d = new Date(date);
        const diff = differenceInDays(d, minDate);
        return diff * dayWidth;
    };

    const getWidth = (start: Date | string, end: Date | string) => {
        const s = new Date(start);
        const e = new Date(end);
        const diff = differenceInDays(e, s);
        return Math.max(diff * dayWidth, dayWidth); // Min 1 day width
    };

    return (
        <Card>
            <CardContent className="p-0">
                <ScrollArea className="h-[600px] w-full border rounded-md">
                    <div className="flex flex-col min-w-max">
                        {/* Header */}
                        <div className="flex sticky top-0 bg-background z-10 border-b">
                            <div className="w-[200px] p-2 font-semibold border-r sticky left-0 bg-background z-20">
                                Task
                            </div>
                            <div className="flex">
                                {days.map((day, i) => (
                                    <div
                                        key={i}
                                        className={cn(
                                            "w-[40px] px-1 text-xs border-r text-center py-2 flex flex-col justify-center",
                                            day.getDay() === 0 || day.getDay() === 6 ? "bg-muted/30" : ""
                                        )}
                                    >
                                        <span className="font-bold text-muted-foreground">{format(day, "d")}</span>
                                        <span className="text-[10px] uppercase text-muted-foreground">{format(day, "EE")}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Body */}
                        <div className="relative">
                            {tasks.map((task) => {
                                const start = task.startAt || task.createdAt;
                                const end = task.dueAt || new Date();
                                const left = getPosition(start);
                                const width = getWidth(start, end);

                                return (
                                    <div key={task.id} className="flex border-b hover:bg-muted/5 group">
                                        <div className="w-[200px] p-2 text-sm truncate border-r sticky left-0 bg-background z-10 group-hover:bg-muted/5 font-medium">
                                            {task.title}
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                {task.assignments.map(a => a.user.name).join(", ")}
                                            </div>
                                        </div>
                                        <div className="relative h-12 flex-1">
                                            {/* Grid lines */}
                                            <div className="absolute inset-0 flex pointer-events-none">
                                                {days.map((day, i) => (
                                                    <div
                                                        key={i}
                                                        className={cn(
                                                            "w-[40px] border-r h-full",
                                                            day.getDay() === 0 || day.getDay() === 6 ? "bg-muted/30" : ""
                                                        )}
                                                    />
                                                ))}
                                            </div>

                                            {/* Bar */}
                                            <div
                                                className={cn(
                                                    "absolute top-2 h-8 rounded-md shadow-sm border flex items-center px-2 text-xs text-white overflow-hidden whitespace-nowrap transition-all",
                                                    task.status === "DONE" ? "bg-green-600 border-green-700 opacity-60" :
                                                        task.status === "DOING" ? "bg-blue-600 border-blue-700" :
                                                            task.status === "BLOCKED" ? "bg-red-500 border-red-600" :
                                                                "bg-slate-500 border-slate-600"
                                                )}
                                                style={{ left: `${left}px`, width: `${width}px` }}
                                            >
                                                {task.status}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
