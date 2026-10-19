"use client";

import { Info, AlertTriangle, CheckCircle, Lightbulb } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import type { Block } from "./block-editor";

const variantStyles: Record<string, { icon: typeof Info; className: string }> = {
    info: { icon: Info, className: "bg-blue-500/10 border-blue-500/30 text-blue-100" },
    warning: { icon: AlertTriangle, className: "bg-yellow-500/10 border-yellow-500/30 text-yellow-100" },
    success: { icon: CheckCircle, className: "bg-emerald-500/10 border-emerald-500/30 text-emerald-100" },
    tip: { icon: Lightbulb, className: "bg-violet-500/10 border-violet-500/30 text-violet-100" },
};

export function CalloutBlock({ block }: { block: Block }) {
    const style = variantStyles[(block.variant as string) ?? "info"] ?? variantStyles.info;
    const Icon = style.icon;

    return (
        <div className={cn("rounded-xl border p-4 flex gap-3", style.className)}>
            <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="prose prose-sm prose-invert max-w-none flex-1 [&>*]:my-1 [&_p]:my-1">
                <ReactMarkdown>{block.content || ""}</ReactMarkdown>
            </div>
        </div>
    );
}
