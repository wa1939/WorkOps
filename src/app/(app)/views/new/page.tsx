"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Sparkles, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { VIEW_TEMPLATES, BLANK_TEMPLATE, SABAH_VIEW_ICON, type ViewTemplate } from "@/lib/view-templates";
import { PRESET_COVERS } from "@/components/view-blocks/cover-picker";
import { SAVED_VIEWS_REFRESH_EVENT } from "@/components/layout/saved-views-list";
import { SabahAvatar } from "@/components/sabah/sabah-avatar";

export default function NewViewPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [selected, setSelected] = useState<ViewTemplate | null>(null);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [loading, setLoading] = useState(false);
    const sabahTemplate = VIEW_TEMPLATES.find((template) => template.id === "sabah-workspace");

    const handlePick = (template: ViewTemplate) => {
        setSelected(template);
        setName(template.name);
        setDescription(template.description);
    };

    const handleCreate = async () => {
        if (!selected || !name.trim()) return;
        setLoading(true);

        try {
            const payload = {
                __meta: { cover: selected.cover || null },
                blocks: selected.blocks,
            };

            const res = await fetch("/api/saved-views", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description.trim() || null,
                    color: selected.color,
                    icon: selected.icon,
                    blocksJson: JSON.stringify(payload),
                }),
            });

            if (res.ok) {
                const view = await res.json();
                window.dispatchEvent(new CustomEvent(SAVED_VIEWS_REFRESH_EVENT));
                router.push(`/views/${view.id}/edit`);
            } else {
                const err = await res.json().catch(() => null);
                toast({
                    title: "Error",
                    description: err?.error || "Failed to create view",
                    variant: "destructive",
                });
            }
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Error creating view", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto animate-fade-in space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <Button variant="ghost" asChild className="mb-3">
                        <Link href="/">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back
                        </Link>
                    </Button>
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                            <Sparkles className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight">Create a view</h1>
                            <p className="text-muted-foreground">Start from a polished template, or build your own from scratch.</p>
                        </div>
                    </div>
                </div>
            </div>

            {sabahTemplate && (
                <section aria-labelledby="featured-sabah-template">
                    <div className="mb-3 flex items-end justify-between gap-3"><div><h2 id="featured-sabah-template" className="text-sm font-semibold text-foreground">Featured operational view</h2><p className="mt-1 text-sm text-muted-foreground">A personal daily dashboard with Sabah grounded in your live work.</p></div><span className="rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-1 text-xs font-medium text-fuchsia-700 dark:text-fuchsia-300">Sabah</span></div>
                    <div className="max-w-2xl"><TemplateCard template={sabahTemplate} onPick={handlePick} /></div>
                </section>
            )}

            <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Templates</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {VIEW_TEMPLATES.filter((template) => template.id !== "sabah-workspace").map((tpl) => <TemplateCard key={tpl.id} template={tpl} onPick={handlePick} />)}
                </div>
            </section>
            <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Start from scratch</h2>
                <TemplateCard template={BLANK_TEMPLATE} onPick={handlePick} compact />
            </section>

            {/* Customize dialog */}
            <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
                <DialogContent className="[@media(pointer:coarse)]:[&>button]:min-h-11 [@media(pointer:coarse)]:[&>button]:min-w-11">
                    <DialogHeader>
                        <DialogTitle>Customize your view</DialogTitle>
                    </DialogHeader>
                    {selected && (
                        <div className="space-y-4">
                            {selected.cover && (
                                <div
                                    className="h-20 rounded-lg"
                                    style={{
                                        background: PRESET_COVERS.find((p) => p.id === selected.cover)?.url ?? selected.cover,
                                    }}
                                />
                            )}
                            <div>
                                <Label htmlFor="view-name">Name</Label>
                                <Input
                                    id="view-name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g. Q2 Dashboard"
                                    className="mt-1 min-h-11 text-base sm:text-sm"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <Label htmlFor="view-desc">Description (optional)</Label>
                                <Textarea
                                    id="view-desc"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    rows={2}
                                    className="mt-1 text-base sm:text-sm"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                You can fully customize the view after creating — change cover, icon, color, add and remove blocks.
                            </p>
                        </div>
                    )}
                    <DialogFooter>
                        <Button className="min-h-11" variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
                        <Button className="min-h-11" onClick={handleCreate} disabled={loading || !name.trim()}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Create view
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function TemplateCard({
    template,
    onPick,
    compact,
}: {
    template: ViewTemplate;
    onPick: (t: ViewTemplate) => void;
    compact?: boolean;
}) {
    const cover = template.cover ? PRESET_COVERS.find((p) => p.id === template.cover)?.url : null;

    return (
        <button
            type="button"
            onClick={() => onPick(template)}
            className={cn(
                "group text-left rounded-xl border-2 border-border overflow-hidden bg-card hover:border-violet-500/50 hover:shadow-lg hover:shadow-violet-500/10 transition-all",
                compact && "flex items-center gap-4 p-4 max-w-md",
            )}
        >
            {!compact && (
                <div
                    className="h-24 w-full relative"
                    style={cover ? { background: cover } : { background: template.id === "sabah-workspace" ? "hsl(var(--muted))" : "repeating-linear-gradient(45deg, hsl(var(--muted)), hsl(var(--muted)) 10px, hsl(var(--background)) 10px, hsl(var(--background)) 20px)" }}
                >
                    <div className="absolute bottom-2 right-2 w-10 h-10 rounded-xl bg-background/80 backdrop-blur flex items-center justify-center text-xl">
                        {template.icon === SABAH_VIEW_ICON ? <SabahAvatar size="md" /> : template.icon}
                    </div>
                </div>
            )}
            <div className={cn("p-4 space-y-1", compact && "p-0 flex-1")}>
                {compact && (
                    <div className="text-2xl">{template.icon === SABAH_VIEW_ICON ? <SabahAvatar size="md" /> : template.icon}</div>
                )}
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                    {template.tagline}
                </p>
                <h3 className="font-semibold text-foreground group-hover:text-violet-400 transition-colors">
                    {template.name}
                </h3>
                <p className="text-sm text-muted-foreground line-clamp-2">{template.description}</p>
                {!compact && (
                    <div className="pt-2 flex items-center gap-1 text-xs text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Check className="h-3 w-3" />
                        Use this template
                    </div>
                )}
            </div>
        </button>
    );
}
