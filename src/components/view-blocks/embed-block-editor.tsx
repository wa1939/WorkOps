"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Block } from "./block-editor";
import { Link2 } from "lucide-react";

interface EmbedBlockEditorProps {
    block: Block;
    onUpdate: (block: Block) => void;
}

export function EmbedBlockEditor({ block, onUpdate }: EmbedBlockEditorProps) {
    return (
        <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Embed Block
            </p>
            <div className="space-y-2">
                <Label className="text-xs">Embed URL</Label>
                <Input
                    value={block.url || ""}
                    onChange={(e) => onUpdate({ ...block, url: e.target.value })}
                    placeholder="https://www.youtube.com/embed/..."
                />
                <p className="text-xs text-muted-foreground">
                    Supports YouTube, Vimeo, Maps, and other iframe-compatible URLs.
                </p>
            </div>
            <div className="relative aspect-video bg-muted rounded-lg overflow-hidden border-2 border-dashed">
                {block.url ? (
                    <iframe
                        src={block.url}
                        className="w-full h-full"
                        allowFullScreen
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                            <Link2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p className="text-xs">Enter a URL to preview</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
