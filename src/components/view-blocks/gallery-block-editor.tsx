"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import type { Block } from "./block-editor";

export function GalleryBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
    const urls: string[] = (block.urls as string[]) ?? [];
    const cols = (block.cols as number) ?? 3;

    const updateUrl = (idx: number, value: string) => {
        const next = [...urls];
        next[idx] = value;
        onUpdate({ ...block, urls: next });
    };
    const addUrl = () => onUpdate({ ...block, urls: [...urls, ""] });
    const removeUrl = (idx: number) => onUpdate({ ...block, urls: urls.filter((_, i) => i !== idx) });

    return (
        <div className="space-y-2">
            <div className="flex gap-1">
                {[2, 3, 4].map((n) => (
                    <Button
                        key={n}
                        type="button"
                        size="sm"
                        variant={cols === n ? "default" : "outline"}
                        onClick={() => onUpdate({ ...block, cols: n })}
                        className="h-7 text-xs"
                    >
                        {n} cols
                    </Button>
                ))}
            </div>
            {urls.map((u, i) => (
                <div key={i} className="flex items-center gap-2">
                    <Input
                        value={u}
                        onChange={(e) => updateUrl(i, e.target.value)}
                        placeholder="https://image-url"
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeUrl(i)}>
                        <X className="h-3 w-3" />
                    </Button>
                </div>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={addUrl} className="h-7 text-xs">
                <Plus className="mr-1 h-3 w-3" />
                Add image
            </Button>
        </div>
    );
}
