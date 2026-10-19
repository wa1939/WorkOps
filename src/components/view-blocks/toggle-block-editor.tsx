"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChevronRight } from "lucide-react";
import type { Block } from "./block-editor";

export function ToggleBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                <Input
                    value={(block.title as string) ?? ""}
                    onChange={(e) => onUpdate({ ...block, title: e.target.value })}
                    placeholder="Toggle heading (e.g. Details, Risks, Archive)"
                    className="font-medium"
                />
            </div>
            <Textarea
                value={block.content ?? ""}
                onChange={(e) => onUpdate({ ...block, content: e.target.value })}
                placeholder="Hidden content (markdown supported). Shows when reader expands the toggle."
                className="ml-6 min-h-[80px]"
            />
        </div>
    );
}
