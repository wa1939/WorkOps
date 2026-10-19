"use client";

import type { Block } from "./block-editor";

export function QuoteBlock({ block }: { block: Block }) {
    return (
        <blockquote className="border-l-4 border-violet-500 pl-4 py-2">
            <p className="text-lg italic text-foreground">{block.content}</p>
            {block.attribution && (
                <footer className="mt-2 text-sm text-muted-foreground">— {block.attribution as string}</footer>
            )}
        </blockquote>
    );
}
