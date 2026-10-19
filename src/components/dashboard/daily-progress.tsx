"use client";

import { motion } from "framer-motion";

export function DailyProgress({
    completed,
    total,
}: {
    completed: number;
    total: number;
}) {
    const target = completed + total; // total open + completed today
    const pct = target > 0 ? Math.round((completed / target) * 100) : 0;

    return (
        <div className="glass-card rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Today&apos;s Progress</p>
                <p className="text-xs text-muted-foreground">
                    {completed} of {target} tasks
                </p>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-purple-500 to-green-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
                />
            </div>
        </div>
    );
}
