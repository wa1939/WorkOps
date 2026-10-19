"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

const DISMISS_KEY = "mission_banner_dismissed";

export function MissionBanner() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const dismissed = sessionStorage.getItem(DISMISS_KEY);
        if (!dismissed) setVisible(true);
    }, []);

    const dismiss = () => {
        setVisible(false);
        sessionStorage.setItem(DISMISS_KEY, "1");
    };

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    className="relative rounded-xl bg-gradient-to-r from-primary/10 via-purple-500/10 to-pink-500/10 border border-primary/20 px-5 py-3"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                >
                    <p className="text-sm text-center text-foreground/80 pr-6">
                        Empowering CEE to deliver excellence through collaboration, innovation, and impact.
                    </p>
                    <button
                        onClick={dismiss}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
