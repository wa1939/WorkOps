"use client";

import { motion } from "framer-motion";

export function WeeklyRing({ completed }: { completed: number }) {
    const target = Math.max(completed, 10); // rough weekly target
    const pct = Math.min(Math.round((completed / target) * 100), 100);
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (pct / 100) * circumference;

    return (
        <div className="flex flex-col items-center justify-center py-2">
            <svg width="100" height="100" viewBox="0 0 100 100">
                <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke="hsl(var(--muted))"
                    strokeWidth="8"
                />
                <motion.circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke="url(#weeklyGrad)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset }}
                    transition={{ duration: 1, ease: "easeOut", delay: 0.4 }}
                    transform="rotate(-90 50 50)"
                />
                <defs>
                    <linearGradient id="weeklyGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="hsl(var(--primary))" />
                        <stop offset="100%" stopColor="#ec4899" />
                    </linearGradient>
                </defs>
                <text
                    x="50"
                    y="46"
                    textAnchor="middle"
                    className="fill-foreground text-lg font-bold"
                    fontSize="18"
                >
                    {completed}
                </text>
                <text
                    x="50"
                    y="60"
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    fontSize="9"
                >
                    completed
                </text>
            </svg>
        </div>
    );
}
