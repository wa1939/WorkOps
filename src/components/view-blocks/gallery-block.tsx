"use client";

import { cn } from "@/lib/utils";
import type { Block } from "./block-editor";

export function GalleryBlock({ block }: { block: Block }) {
    const urls: string[] = (block.urls as string[]) ?? [];
    const cols = (block.cols as number) ?? 3;
    if (urls.length === 0) return null;

    const gridClass = cols === 2 ? "grid-cols-2" : cols === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3";

    return (
        <div className={cn("grid gap-2", gridClass)}>
            {urls.filter(Boolean).map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    key={i}
                    src={u}
                    alt=""
                    className="w-full aspect-square object-cover rounded-lg border border-border"
                />
            ))}
        </div>
    );
}
