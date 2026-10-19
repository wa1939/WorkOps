"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Flame } from "lucide-react";

interface StreakData {
    currentStreak: number;
    bestStreak: number;
    totalPoints: number;
    lastActiveAt: string | null;
    activeDays?: string[];
}

export function StreakWidget() {
    const [streak, setStreak] = useState<StreakData | null>(null);

    useEffect(() => {
        fetch("/api/streak")
            .then((r) => r.json())
            .then(setStreak)
            .catch(() => {});
    }, []);

    if (!streak) return null;

    const today = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (6 - i));
        return d;
    });

    // The API reports exactly which of the last 7 days had a completion, so the dots no
    // longer have to be reconstructed from streak length and lastActiveAt.
    const activeDays = new Set(streak.activeDays ?? []);

    return (
        <motion.div
            className="glass-card rounded-xl p-4"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
        >
            <div className="flex items-center gap-3 mb-3">
                <div className={`p-2 rounded-lg ${streak.currentStreak > 0 ? "bg-orange-500/15 streak-glow" : "bg-muted"}`}>
                    <Flame className={`h-5 w-5 ${streak.currentStreak > 0 ? "text-orange-500" : "text-muted-foreground"}`} />
                </div>
                <div>
                    <p className="text-lg font-bold leading-tight">{streak.currentStreak} day streak</p>
                    <p className="text-xs text-muted-foreground">Best: {streak.bestStreak}</p>
                </div>
            </div>
            <div className="flex items-center gap-1.5 justify-center">
                {days.map((d, i) => {
                    const isActive = activeDays.has(d.toISOString().slice(0, 10));
                    const isToday = d.toDateString() === today.toDateString();
                    return (
                        <div
                            key={i}
                            className={`h-3 w-3 rounded-full transition-colors ${
                                isActive
                                    ? "bg-orange-500"
                                    : isToday
                                    ? "bg-muted-foreground/30 ring-1 ring-orange-500/50"
                                    : "bg-muted-foreground/15"
                            }`}
                            title={d.toLocaleDateString("en-US", { weekday: "short" })}
                        />
                    );
                })}
            </div>
        </motion.div>
    );
}
