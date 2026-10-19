"use client";

import { useState } from "react";
import type { Block } from "./block-editor";
import { cn } from "@/lib/utils";

type TodoItem = { id: string; text: string; done: boolean };

export function TodoBlock({ block }: { block: Block }) {
    const initial: TodoItem[] = (block.items as TodoItem[]) ?? [];
    const [items, setItems] = useState(initial);

    const toggle = (id: string) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
    };

    if (items.length === 0) return null;

    return (
        <div className="space-y-1.5">
            {items.map((it) => (
                <label key={it.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={it.done}
                        onChange={() => toggle(it.id)}
                        className="h-4 w-4 rounded border-border"
                    />
                    <span className={cn("text-sm", it.done && "line-through text-muted-foreground")}>
                        {it.text}
                    </span>
                </label>
            ))}
        </div>
    );
}
