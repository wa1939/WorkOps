"use client";

import ReactMarkdown from "react-markdown";
import type { Block } from "./block-editor";

export function ToggleBlock({ block }: { block: Block }) {
    return (
        <details className="group rounded-lg border border-border bg-card/50 overflow-hidden">
            <summary className="cursor-pointer px-4 py-3 font-medium list-none flex items-center gap-2 hover:bg-accent/30 transition-colors">
                <span className="text-muted-foreground group-open:rotate-90 transition-transform">▶</span>
                <span>{(block.title as string) || "Toggle"}</span>
            </summary>
            <div className="px-4 pb-3 pt-1">
                <div className="prose prose-sm prose-invert max-w-none [&>*]:my-1 [&_p]:my-1">
                    <ReactMarkdown>{block.content || ""}</ReactMarkdown>
                </div>
            </div>
        </details>
    );
}
