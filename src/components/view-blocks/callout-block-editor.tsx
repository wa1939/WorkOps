"use client";

import { Info, AlertTriangle, CheckCircle, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Block } from "./block-editor";

const variants = [
    { id: "info", icon: Info, label: "Info", className: "bg-blue-500/10 border-blue-500/30 text-blue-300" },
    { id: "warning", icon: AlertTriangle, label: "Warning", className: "bg-yellow-500/10 border-yellow-500/30 text-yellow-300" },
    { id: "success", icon: CheckCircle, label: "Success", className: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" },
    { id: "tip", icon: Lightbulb, label: "Tip", className: "bg-violet-500/10 border-violet-500/30 text-violet-300" },
] as const;

export function CalloutBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
    const variant = (block.variant as string) ?? "info";
    const active = variants.find((v) => v.id === variant) ?? variants[0];
    const Icon = active.icon;

    return (
        <div className="space-y-2">
            <div className="flex gap-1 flex-wrap">
                {variants.map((v) => {
                    const VIcon = v.icon;
                    return (
                        <Button
                            key={v.id}
                            type="button"
                            size="sm"
                            variant={variant === v.id ? "default" : "outline"}
                            onClick={() => onUpdate({ ...block, variant: v.id })}
                            className="h-7 text-xs"
                        >
                            <VIcon className="mr-1 h-3 w-3" />
                            {v.label}
                        </Button>
                    );
                })}
            </div>
            <div className={cn("rounded-lg border p-3 flex gap-3", active.className)}>
                <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <Textarea
                    value={block.content ?? ""}
                    onChange={(e) => onUpdate({ ...block, content: e.target.value })}
                    placeholder="Write your callout message…"
                    className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 min-h-[40px] text-sm resize-none"
                />
            </div>
        </div>
    );
}
