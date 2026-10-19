"use client";

import type { Block } from "./block-editor";

export function CodeBlock({ block }: { block: Block }) {
    return (
        <div className="rounded-lg overflow-hidden border border-border bg-zinc-950">
            {block.language && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground bg-zinc-900 border-b border-border">
                    {block.language as string}
                </div>
            )}
            <pre className="p-3 text-sm text-zinc-200 overflow-x-auto">
                <code>{block.content}</code>
            </pre>
        </div>
    );
}
