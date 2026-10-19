"use client";

import { motion } from "framer-motion";
import { getTodayQuote } from "@/lib/daily-quotes";

export function DailyQuote() {
    const quote = getTodayQuote();

    return (
        <motion.div
            className="glass-card rounded-xl p-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
        >
            <p className="text-sm italic text-muted-foreground leading-relaxed">
                &ldquo;{quote.text_en}&rdquo;
            </p>
            <p className="text-xs text-right text-muted-foreground/70 mt-1 font-arabic" dir="rtl">
                {quote.text_ar}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
                &mdash; {quote.author}
            </p>
        </motion.div>
    );
}
