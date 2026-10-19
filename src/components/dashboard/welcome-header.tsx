"use client";

import { motion } from "framer-motion";

export function WelcomeHeader({ userName }: { userName: string }) {
    const now = new Date();
    const hour = now.getHours();
    const greeting =
        hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    const gregorian = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
    }).format(now);

    const hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic", {
        day: "numeric",
        month: "long",
        year: "numeric",
    }).format(now);

    return (
        <div className="space-y-1">
            <motion.h1
                className="text-3xl font-bold tracking-tight"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                {greeting}, {userName?.split(" ")[0]}!
            </motion.h1>
            <motion.p
                className="text-muted-foreground"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
            >
                {gregorian} &middot; {hijri}
            </motion.p>
        </div>
    );
}
