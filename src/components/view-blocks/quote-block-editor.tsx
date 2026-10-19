"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Block } from "./block-editor";

export function QuoteBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
    return (
        <div className="space-y-2 border-l-4 border-violet-500 pl-4">
            <Textarea
                value={block.content ?? ""}
                onChange={(e) => onUpdate({ ...block, content: e.target.value })}
                placeholder="Write a memorable quote or key insight…"
                className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 text-lg italic resize-none min-h-[60px]"
            />
            <Input
                value={(block.attribution as string) ?? ""}
                onChange={(e) => onUpdate({ ...block, attribution: e.target.value })}
                placeholder="— Attribution (optional)"
                className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 text-sm text-muted-foreground"
            />
        </div>
    );
}
