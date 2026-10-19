import type { Block } from "@/components/view-blocks/block-editor";

export interface ParsedBlocks {
    cover: string | null;
    blocks: Block[];
}

export function parseBlocksJson(raw: string | null | undefined): ParsedBlocks {
    if (!raw) return { cover: null, blocks: [] };
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return { cover: null, blocks: parsed as Block[] };
        }
        if (parsed && typeof parsed === "object" && "blocks" in parsed) {
            const meta = (parsed as { __meta?: { cover?: string | null } }).__meta;
            return {
                cover: meta?.cover ?? null,
                blocks: ((parsed as { blocks?: Block[] }).blocks ?? []) as Block[],
            };
        }
        return { cover: null, blocks: [] };
    } catch {
        return { cover: null, blocks: [] };
    }
}
