"use client";

import { Textarea } from "@/components/ui/textarea";
import { Block } from "./block-editor";

interface TextBlockEditorProps {
    block: Block;
    onUpdate: (block: Block) => void;
}

export function TextBlockEditor({ block, onUpdate }: TextBlockEditorProps) {
    return (
        <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Text Block
            </p>
            <Textarea
                value={block.content || ""}
                onChange={(e) => onUpdate({ ...block, content: e.target.value })}
                placeholder="Write your content here... (Markdown supported)"
                rows={3}
                className="resize-none"
            />
            <p className="text-xs text-muted-foreground">Supports Markdown formatting</p>
        </div>
    );
}
