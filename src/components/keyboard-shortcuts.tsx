"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

const shortcuts = [
    { key: "⌘K / Ctrl+K", description: "Open command palette", action: "palette" },
    { key: "⌘N / Ctrl+N", description: "Quick create new task", action: "/tasks/new" },
    { key: "c", description: "Create new task", action: "/tasks/new" },
    { key: "t", description: "Go to tasks", action: "/tasks" },
    { key: "d", description: "Go to home", action: "/" },
    { key: "p", description: "Go to projects", action: "/projects" },
    { key: "n", description: "Go to notes", action: "/notes" },
    { key: "?", description: "Show keyboard shortcuts", action: "help" },
];

export function KeyboardShortcuts() {
    const router = useRouter();
    const [showHelp, setShowHelp] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't trigger in inputs/textareas/selects
            const target = e.target as HTMLElement;
            if (
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.tagName === "SELECT" ||
                target.isContentEditable
            ) {
                return;
            }

            // Cmd/Ctrl + N → quick create task, from anywhere (including inputs unless it's the new-task title)
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
                if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
                e.preventDefault();
                router.push("/tasks/new");
                return;
            }

            // Don't trigger single-letter shortcuts with modifier keys or inside inputs (already returned above)
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            switch (e.key) {
                case "c":
                    e.preventDefault();
                    router.push("/tasks/new");
                    break;
                case "t":
                    e.preventDefault();
                    router.push("/tasks");
                    break;
                case "d":
                    e.preventDefault();
                    router.push("/");
                    break;
                case "p":
                    e.preventDefault();
                    router.push("/projects");
                    break;
                case "n":
                    e.preventDefault();
                    router.push("/notes");
                    break;
                case "?":
                    e.preventDefault();
                    setShowHelp(true);
                    break;
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [router]);

    return (
        <Dialog open={showHelp} onOpenChange={setShowHelp}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Keyboard Shortcuts</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    {shortcuts.map((s) => (
                        <div key={s.key} className="flex items-center justify-between py-1">
                            <span className="text-sm">{s.description}</span>
                            <Kbd>{s.key}</Kbd>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
