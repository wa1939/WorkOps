"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Flame, Trophy, TrendingUp, Zap } from "lucide-react";

import { Block } from "./block-editor";

interface ProgressBlockProps {
    block: Block;
    userId: string;
}

interface Stats {
    currentStreak: number;
    bestStreak: number;
    completedToday: number;
    totalActive: number;
    progressPercent: number;
}

export function ProgressBlock({ block, userId }: ProgressBlockProps) {
    const [stats, setStats] = useState<Stats>({
        currentStreak: 0,
        bestStreak: 0,
        completedToday: 0,
        totalActive: 0,
        progressPercent: 0,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                // Fetch user tasks to calculate stats
                const res = await fetch("/api/tasks?tab=my");
                if (res.ok) {
                    const data = await res.json();
                    const tasks = Array.isArray(data) ? data : [];

                    // Calculate basic stats
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);

                    const completedToday = tasks.filter((t: { status: string; doneAt: string }) => {
                        if (t.status !== "DONE" || !t.doneAt) return false;
                        const doneDate = new Date(t.doneAt);
                        doneDate.setHours(0, 0, 0, 0);
                        return doneDate.getTime() === today.getTime();
                    }).length;

                    const doneTasks = tasks.filter((t: { status: string }) => t.status === "DONE").length;
                    const totalTasks = tasks.length;
                    const progressPercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

                    setStats({
                        currentStreak: completedToday > 0 ? 1 : 0, // Simplified
                        bestStreak: 1, // Would need history
                        completedToday,
                        totalActive: tasks.filter((t: { status: string }) => t.status !== "DONE").length,
                        progressPercent,
                    });
                }
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, [userId]);

    if (loading) {
        return (
            <Card className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-violet-500/20">
                <CardContent className="p-6">
                    <div className="flex justify-center py-4">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-violet-500/20 overflow-hidden">
            <CardContent className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div className="text-center">
                        <div className="w-12 h-12 mx-auto rounded-xl bg-orange-500/20 flex items-center justify-center mb-2">
                            <Flame className="h-6 w-6 text-orange-500" />
                        </div>
                        <p className="text-3xl font-bold">{stats.currentStreak}</p>
                        <p className="text-xs text-muted-foreground">Day Streak</p>
                    </div>
                    <div className="text-center">
                        <div className="w-12 h-12 mx-auto rounded-xl bg-yellow-500/20 flex items-center justify-center mb-2">
                            <Trophy className="h-6 w-6 text-yellow-500" />
                        </div>
                        <p className="text-3xl font-bold">{stats.bestStreak}</p>
                        <p className="text-xs text-muted-foreground">Best Streak</p>
                    </div>
                    <div className="text-center">
                        <div className="w-12 h-12 mx-auto rounded-xl bg-green-500/20 flex items-center justify-center mb-2">
                            <Zap className="h-6 w-6 text-green-500" />
                        </div>
                        <p className="text-3xl font-bold">{stats.completedToday}</p>
                        <p className="text-xs text-muted-foreground">Done Today</p>
                    </div>
                    <div className="text-center">
                        <div className="w-12 h-12 mx-auto rounded-xl bg-blue-500/20 flex items-center justify-center mb-2">
                            <TrendingUp className="h-6 w-6 text-blue-500" />
                        </div>
                        <p className="text-3xl font-bold">{stats.progressPercent}%</p>
                        <p className="text-xs text-muted-foreground">Progress</p>
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-6">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{stats.totalActive} active tasks</span>
                        <span>{stats.progressPercent}% complete</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-500"
                            style={{ width: `${stats.progressPercent}%` }}
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
