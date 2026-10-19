"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ImageIcon, X } from "lucide-react";
import React, { useState } from "react";
import { cn } from "@/lib/utils";

export const PRESET_COVERS = [
    { id: "grad-violet", label: "Violet Dream", url: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)", isGradient: true },
    { id: "grad-ocean", label: "Ocean", url: "linear-gradient(135deg, #0ea5e9 0%, #3b82f6 100%)", isGradient: true },
    { id: "grad-sunset", label: "Sunset", url: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)", isGradient: true },
    { id: "grad-forest", label: "Forest", url: "linear-gradient(135deg, #059669 0%, #10b981 100%)", isGradient: true },
    { id: "grad-twilight", label: "Twilight", url: "linear-gradient(135deg, #1e293b 0%, #7c3aed 100%)", isGradient: true },
    { id: "grad-sunrise", label: "Sunrise", url: "linear-gradient(135deg, #fbbf24 0%, #fb7185 50%, #a855f7 100%)", isGradient: true },
    { id: "grad-aurora", label: "Aurora", url: "linear-gradient(135deg, #06b6d4 0%, #8b5cf6 50%, #ec4899 100%)", isGradient: true },
    { id: "grad-mint", label: "Mint", url: "linear-gradient(135deg, #a7f3d0 0%, #34d399 100%)", isGradient: true },
    { id: "grad-rose", label: "Rose", url: "linear-gradient(135deg, #fecdd3 0%, #f43f5e 100%)", isGradient: true },
    { id: "grad-midnight", label: "Midnight", url: "linear-gradient(135deg, #0c0a1f 0%, #312e81 50%, #1e1b4b 100%)", isGradient: true },
];

export function resolveCover(value: string | null | undefined): { isGradient: boolean; css: string } | null {
    if (!value) return null;
    const preset = PRESET_COVERS.find((p) => p.id === value);
    if (preset) return { isGradient: true, css: preset.url };
    if (value.startsWith("http")) return { isGradient: false, css: value };
    if (value.startsWith("linear-gradient")) return { isGradient: true, css: value };
    return null;
}

export function CoverPicker({
    value,
    onChange,
    className,
}: {
    value: string | null;
    onChange: (v: string | null) => void;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [urlInput, setUrlInput] = useState("");

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className={cn("gap-1.5", className)}>
                    <ImageIcon className="h-3.5 w-3.5" />
                    {value ? "Change cover" : "Add cover"}
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Pick a cover</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div>
                        <p className="text-sm font-medium mb-2">Preset gradients</p>
                        <div className="grid grid-cols-5 gap-2">
                            {PRESET_COVERS.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => {
                                        onChange(preset.id);
                                        setOpen(false);
                                    }}
                                    className={cn(
                                        "h-16 rounded-lg border-2 transition-all hover:scale-105",
                                        value === preset.id ? "border-violet-500 ring-2 ring-violet-500/30" : "border-border",
                                    )}
                                    style={{ background: preset.url }}
                                    title={preset.label}
                                />
                            ))}
                        </div>
                    </div>
                    <div>
                        <p className="text-sm font-medium mb-2">Or paste an image URL</p>
                        <div className="flex gap-2">
                            <Input
                                value={urlInput}
                                onChange={(e) => setUrlInput(e.target.value)}
                                placeholder="https://images.unsplash.com/…"
                            />
                            <Button
                                type="button"
                                onClick={() => {
                                    if (urlInput.trim()) {
                                        onChange(urlInput.trim());
                                        setOpen(false);
                                    }
                                }}
                                disabled={!urlInput.trim()}
                            >
                                Apply
                            </Button>
                        </div>
                    </div>
                </div>
                <DialogFooter className="sm:justify-between">
                    {value && (
                        <Button
                            variant="ghost"
                            onClick={() => {
                                onChange(null);
                                setOpen(false);
                            }}
                        >
                            <X className="mr-1 h-4 w-4" />
                            Remove cover
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
