"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import type { Block } from "./block-editor";

type TodoItem = { id: string; text: string; done: boolean };

export function TodoBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
    const items: TodoItem[] = (block.items as TodoItem[]) ?? [];

    const addItem = () => {
        onUpdate({ ...block, items: [...items, { id: `t-${Date.now()}`, text: "", done: false }] });
    };
    const updateItem = (id: string, patch: Partial<TodoItem>) => {
        onUpdate({ ...block, items: items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
    };
    const removeItem = (id: string) => {
        onUpdate({ ...block, items: items.filter((it) => it.id !== id) });
    };

    return (
        <div className="space-y-1.5">
            {items.map((it) => (
                <div key={it.id} className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={it.done}
                        onChange={(e) => updateItem(it.id, { done: e.target.checked })}
                        className="h-4 w-4 rounded border-border"
                    />
                    <Input
                        value={it.text}
                        onChange={(e) => updateItem(it.id, { text: e.target.value })}
                        placeholder="To-do item…"
                        className={`border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 ${it.done ? "line-through text-muted-foreground" : ""}`}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(it.id)}>
                        <X className="h-3 w-3" />
                    </Button>
                </div>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={addItem} className="h-7 text-xs">
                <Plus className="mr-1 h-3 w-3" />
                Add item
            </Button>
        </div>
    );
}
