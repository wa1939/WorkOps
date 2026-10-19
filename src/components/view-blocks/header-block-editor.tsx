"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Block } from "./block-editor";
import { cn } from "@/lib/utils";

interface HeaderBlockEditorProps {
    block: Block;
    onUpdate: (block: Block) => void;
}

export function HeaderBlockEditor({ block, onUpdate }: HeaderBlockEditorProps) {
    const sizes = [
        { value: "h1", label: "H1", className: "text-3xl font-bold" },
        { value: "h2", label: "H2", className: "text-2xl font-semibold" },
        { value: "h3", label: "H3", className: "text-xl font-medium" },
    ];

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Header Block
                </p>
                <div className="flex gap-1">
                    {sizes.map((s) => (
                        <Button
                            key={s.value}
                            variant={block.size === s.value ? "default" : "outline"}
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => onUpdate({ ...block, size: s.value as Block["size"] })}
                        >
                            {s.label}
                        </Button>
                    ))}
                </div>
            </div>
            <Input
                value={block.content || ""}
                onChange={(e) => onUpdate({ ...block, content: e.target.value })}
                placeholder="Section title..."
                className={cn(
                    "border-0 bg-transparent focus-visible:ring-0 px-0",
                    sizes.find((s) => s.value === block.size)?.className
                )}
            />
        </div>
    );
}
