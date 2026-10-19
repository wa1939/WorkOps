"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AiQuickAddProps {
    onCreated: () => void;
}

function errorMessage(value: unknown): string {
    if (value && typeof value === "object" && "error" in value) {
        const error = (value as { error?: unknown }).error;
        if (typeof error === "string") return error;
    }
    return "Could not add task";
}

export function AiQuickAdd({ onCreated }: AiQuickAddProps) {
    const { toast } = useToast();
    const [text, setText] = useState("");
    const [pending, setPending] = useState(false);

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const value = text.trim();
        if (!value || pending) return;
        setPending(true);
        try {
            const response = await fetch("/api/ai/task-actions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "parse-add", text: value }),
            });
            const payload = await response.json().catch(() => null) as unknown;
            if (!response.ok) throw new Error(errorMessage(payload));
            const created = payload && typeof payload === "object" && "created" in payload
                ? (payload as { created?: unknown }).created
                : null;
            if (!created || typeof created !== "object") throw new Error("Task was created without a valid response");
            setText("");
            onCreated();
            toast({ title: "Task added" });
        } catch (error: unknown) {
            toast({
                title: "Could not add task",
                description: error instanceof Error ? error.message : "Try again.",
                variant: "destructive",
            });
        } finally {
            setPending(false);
        }
    }

    return (
        <form onSubmit={(event) => void submit(event)} className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto sm:max-w-md" aria-busy={pending}>
            <label htmlFor="ai-quick-add" className="sr-only">Ask Sabah to add a task</label>
            <input
                id="ai-quick-add"
                value={text}
                disabled={pending}
                onChange={(event) => setText(event.target.value)}
                placeholder="✦ Ask Sabah to add: ..."
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none transition-[border-color,box-shadow] focus:ring-2 focus:ring-ring disabled:opacity-60"
            />
            <button
                type="submit"
                disabled={pending || !text.trim()}
                className="inline-flex h-10 shrink-0 items-center rounded-md border border-primary/40 px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-label="Adding task" />}
                Add
            </button>
        </form>
    );
}
