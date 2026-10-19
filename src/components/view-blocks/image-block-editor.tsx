"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Block } from "./block-editor";
import { Image as ImageIcon } from "lucide-react";

interface ImageBlockEditorProps {
    block: Block;
    onUpdate: (block: Block) => void;
}

export function ImageBlockEditor({ block, onUpdate }: ImageBlockEditorProps) {
    return (
        <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Image Block
            </p>
            <div className="space-y-2">
                <Label className="text-xs">Image URL</Label>
                <div className="flex gap-2">
                    <Input
                        value={block.url || ""}
                        onChange={(e) => onUpdate({ ...block, url: e.target.value })}
                        placeholder="https://example.com/image.png"
                    />
                </div>
            </div>
            <div className="relative aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center border-2 border-dashed">
                {block.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={block.url}
                        alt="Preview"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                            (e.target as HTMLImageElement).src = ""; // Clear on error
                        }}
                    />
                ) : (
                    <div className="text-center text-muted-foreground">
                        <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-xs">Enter a valid URL to preview</p>
                    </div>
                )}
            </div>
        </div>
    );
}
