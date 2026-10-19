"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Block } from "./block-editor";

export function CodeBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
    return (
        <div className="space-y-2">
            <Input
                value={(block.language as string) ?? ""}
                onChange={(e) => onUpdate({ ...block, language: e.target.value })}
                placeholder="Language (e.g. typescript, python, sql) — optional"
                className="text-xs"
            />
            <Textarea
                value={block.content ?? ""}
                onChange={(e) => onUpdate({ ...block, content: e.target.value })}
                placeholder="// your code here"
                className="font-mono text-sm min-h-[120px]"
            />
        </div>
    );
}
