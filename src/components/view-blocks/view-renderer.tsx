"use client";

import React, { useState } from "react";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Edit, MoreHorizontal, ThumbsUp, Share2 } from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { cn, getInitials } from "@/lib/utils";
import { applyViewQuickFilters } from "@/lib/view-task-client";

import type { Block } from "./block-editor";
import { TaskViewBlock } from "./task-view-block";
import { ProgressBlock } from "./progress-block";
import { CalloutBlock } from "./callout-block";
import { QuoteBlock } from "./quote-block";
import { TodoBlock } from "./todo-block";
import { CodeBlock } from "./code-block";
import { StatTileBlock } from "./stat-tile-block";
import { ChartBlock } from "./chart-block";
import { ToggleBlock } from "./toggle-block";
import { GalleryBlock } from "./gallery-block";
import { KpiSnapshotBlock } from "./kpi-snapshot-block";
import { ProjectSnapshotBlock } from "./project-snapshot-block";
import { resolveCover } from "./cover-picker";
import { SabahWorkspaceBlock } from "./sabah-workspace-block";
import { HomePreferenceControls } from "./home-preference-controls";
import { SabahAvatar } from "@/components/sabah/sabah-avatar";
import { SABAH_VIEW_ICON } from "@/lib/view-templates";

interface ViewRendererProps {
    view: {
        id: string;
        name: string;
        description: string | null;
        color: string;
        icon: string | null;
        owner: { id: string; name: string | null; image: string | null } | null;
        hasVoted: boolean;
        voteCount: number;
        isOwner: boolean;
    };
    blocks: Block[];
    cover?: string | null;
    userId: string;
}

const colorClasses: Record<string, { gradient: string; border: string; bg: string; pageBg: string }> = {
    blue: { gradient: "from-blue-500 to-blue-600", border: "border-blue-500/30", bg: "bg-blue-500/10", pageBg: "from-blue-950/20 to-background" },
    green: { gradient: "from-green-500 to-green-600", border: "border-green-500/30", bg: "bg-green-500/10", pageBg: "from-green-950/20 to-background" },
    purple: { gradient: "from-purple-500 to-purple-600", border: "border-purple-500/30", bg: "bg-purple-500/10", pageBg: "from-purple-950/20 to-background" },
    orange: { gradient: "from-orange-500 to-orange-600", border: "border-orange-500/30", bg: "bg-orange-500/10", pageBg: "from-orange-950/20 to-background" },
    red: { gradient: "from-red-500 to-red-600", border: "border-red-500/30", bg: "bg-red-500/10", pageBg: "from-red-950/20 to-background" },
    pink: { gradient: "from-pink-500 to-pink-600", border: "border-pink-500/30", bg: "bg-pink-500/10", pageBg: "from-pink-950/20 to-background" },
    cyan: { gradient: "from-cyan-500 to-cyan-600", border: "border-cyan-500/30", bg: "bg-cyan-500/10", pageBg: "from-cyan-950/20 to-background" },
    yellow: { gradient: "from-yellow-500 to-yellow-600", border: "border-yellow-500/30", bg: "bg-yellow-500/10", pageBg: "from-yellow-950/20 to-background" },
};

export function ViewRenderer({ view, blocks, cover, userId }: ViewRendererProps) {
    const router = useRouter();
    const [hasVoted, setHasVoted] = useState(view.hasVoted);
    const [voteCount, setVoteCount] = useState(view.voteCount);
    const [voting, setVoting] = useState(false);
    const [activeChips, setActiveChips] = useState<Set<string>>(new Set());

    const colors = colorClasses[view.color] || colorClasses.blue;
    const resolvedCover = resolveCover(cover);
    const firstAssistantWorkspaceIndex = blocks.findIndex((block) => block.type === "assistantWorkspace");
    const isSabahView = firstAssistantWorkspaceIndex >= 0;

    const toggleChip = (id: string) => {
        setActiveChips((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                if (id === "overdue") next.delete("this-week");
                if (id === "this-week") next.delete("overdue");
                next.add(id);
            }
            return next;
        });
    };

    // Void router usage (kept to prevent unused var warnings)
    void router;

    const toggleVote = async () => {
        setVoting(true);
        try {
            const res = await fetch(`/api/saved-views/${view.id}/vote`, {
                method: "POST",
            });
            if (res.ok) {
                const data = await res.json();
                setHasVoted(data.voted);
                setVoteCount((prev) => (data.voted ? prev + 1 : prev - 1));
            }
        } catch (error) {
            console.error(error);
        } finally {
            setVoting(false);
        }
    };

    const chips = [
        { id: "me", label: "Me" },
        { id: "overdue", label: "Overdue" },
        { id: "this-week", label: "This Week" },
        { id: "high-priority", label: "High Priority" },
    ];

    return (
        <div className={cn("min-h-screen p-4 sm:p-6 -m-4 sm:-m-6", isSabahView ? "bg-background" : cn("bg-gradient-to-b", colors.pageBg))}>
            <div className={cn("mx-auto max-w-7xl", isSabahView ? "space-y-4" : "space-y-6")}>
                {/* Cover banner */}
                {resolvedCover && !isSabahView && (
                    <div
                        className={cn("relative w-full overflow-hidden border border-border", isSabahView ? "h-24 rounded-xl" : "h-48 rounded-2xl", isSabahView && "-mb-1")}
                        style={resolvedCover.isGradient
                            ? { background: resolvedCover.css }
                            : { backgroundImage: `url(${resolvedCover.css})`, backgroundSize: "cover", backgroundPosition: "center" }
                        }
                    />
                )}

                {/* Header */}
                {isSabahView ? (
                    <div
                        data-testid="sabah-view-heading"
                        data-cover-selected={resolvedCover ? "true" : "false"}
                        className={cn("relative overflow-hidden rounded-xl border p-3 sm:p-4", colors.border)}
                    >
                        {resolvedCover ? (
                            <div
                                aria-hidden="true"
                                className="absolute inset-0 opacity-25"
                                style={resolvedCover.isGradient
                                    ? { background: resolvedCover.css }
                                    : { backgroundImage: `url(${resolvedCover.css})`, backgroundSize: "cover", backgroundPosition: "center" }
                                }
                            />
                        ) : null}
                        <div className="relative flex items-center justify-between gap-3 sm:flex-wrap">
                            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                {view.icon === SABAH_VIEW_ICON ? <SabahAvatar size="sm" status="idle" /> : <div className={cn("flex size-9 items-center justify-center rounded-lg bg-gradient-to-br text-base text-white", colors.gradient)}>{view.icon || "📊"}</div>}
                                <div className="min-w-0">
                                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                                        <h1 dir="auto" className="line-clamp-2 text-lg font-semibold tracking-tight sm:text-xl">{view.name}</h1>
                                        {view.owner && <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"><Avatar className="h-4 w-4"><AvatarImage src={view.owner.image || ""} /><AvatarFallback className="text-[9px]">{getInitials(view.owner.name || "")}</AvatarFallback></Avatar>{view.owner.name || "Unknown"}</span>}
                                    </div>
                                    {view.description && <p dir="auto" className="mt-0.5 hidden max-w-2xl truncate text-xs text-muted-foreground sm:block">{view.description}</p>}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center justify-end gap-2">
                                <Button variant={hasVoted ? "default" : "outline"} size="sm" className="min-h-11 min-w-11" onClick={toggleVote} disabled={voting} aria-label={`Like view (${voteCount})`}><ThumbsUp className={cn("h-4 w-4 sm:mr-1", hasVoted && "fill-current")} /><span className="hidden sm:inline">{voteCount}</span></Button>
                                {view.isOwner && <Button size="sm" className="min-h-11 min-w-11" asChild><Link href={`/views/${view.id}/edit`}><Edit className="h-4 w-4 sm:mr-1" /><span className="sr-only sm:not-sr-only">Edit</span></Link></Button>}
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" size="icon" className="h-11 w-11 sm:hidden" aria-label="View actions"><MoreHorizontal className="h-4 w-4" /></Button>
                                    </PopoverTrigger>
                                    <PopoverContent align="end" className="w-72 p-3" aria-label="View actions">
                                        <p className="text-sm font-medium">Saved view</p>
                                        {view.owner ? <p className="mt-1 text-xs text-muted-foreground">Created by {view.owner.name || "Unknown"}</p> : null}
                                        {view.description ? <p dir="auto" className="mt-1 text-xs text-muted-foreground">{view.description}</p> : null}
                                        <div role="group" aria-label="Home preference" className="pt-1 [&_button]:min-h-11">
                                            <HomePreferenceControls viewId={view.id} />
                                        </div>
                                    </PopoverContent>
                                </Popover>
                                <div className="hidden sm:flex">
                                    <HomePreferenceControls viewId={view.id} />
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className={cn("rounded-xl border-2 p-6 transition-all", colors.border, colors.bg)}>
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="flex items-center gap-4">
                                {view.icon === SABAH_VIEW_ICON ? <SabahAvatar size="lg" status="idle" /> : <div className={cn("flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-2xl text-white shadow-lg", colors.gradient)}>{view.icon || "📊"}</div>}
                                <div>
                                    <h1 dir="auto" className="text-2xl font-bold">{view.name}</h1>
                                    {view.description && <p dir="auto" className="text-muted-foreground">{view.description}</p>}
                                    {view.owner && <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><Avatar className="h-5 w-5"><AvatarImage src={view.owner.image || ""} /><AvatarFallback className="text-xs">{getInitials(view.owner.name || "")}</AvatarFallback></Avatar><span>Created by {view.owner.name || "Unknown"}</span></div>}
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2"><Button variant={hasVoted ? "default" : "outline"} size="sm" onClick={toggleVote} disabled={voting}><ThumbsUp className={cn("mr-1 h-4 w-4", hasVoted && "fill-current")} />{voteCount}</Button><Button variant="outline" size="sm"><Share2 className="mr-1 h-4 w-4" />Share</Button>{view.isOwner && <Button size="sm" asChild><Link href={`/views/${view.id}/edit`}><Edit className="mr-1 h-4 w-4" />Edit</Link></Button>}<HomePreferenceControls viewId={view.id} /></div>
                        </div>
                    </div>
                )}
                {/* Quick-filter chips */}
                {!isSabahView && <div className="flex flex-wrap gap-2" aria-label="Quick filters">
                    {chips.map((chip) => {
                        const active = activeChips.has(chip.id);
                        return <button key={chip.id} type="button" aria-pressed={active} onClick={() => toggleChip(chip.id)} className={cn("min-h-11 rounded-full border px-4 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground")}>{chip.label}</button>;
                    })}
                </div>}
                {/* Blocks Grid */}
                <div className="grid grid-cols-12 gap-4 sm:gap-6">
                    {blocks.map((block, index) => (
                        <div
                            key={`${block.id}-${index}`}
                            className={cn(
                                block.width === "half" ? "col-span-12 md:col-span-6" :
                                    block.width === "third" ? "col-span-12 md:col-span-4" :
                                        "col-span-12"
                            )}
                        >
                            {/* Text Block */}
                            {block.type === "text" && (
                                <div className="prose dark:prose-invert max-w-none">
                                    <ReactMarkdown>{block.content || ""}</ReactMarkdown>
                                </div>
                            )}

                            {/* Header Block */}
                            {block.type === "header" && (
                                <div className={cn(
                                    "font-bold text-foreground mb-4 mt-8 first:mt-0",
                                    block.size === "h1" ? "text-4xl" :
                                        block.size === "h2" ? "text-3xl" : "text-2xl"
                                )}>
                                    {block.content}
                                </div>
                            )}

                            {/* Task View Block */}
                            {block.type === "taskView" && (() => {
                                const quickFilter = applyViewQuickFilters(block, activeChips);
                                return <TaskViewBlock block={quickFilter.block} filterConflict={quickFilter.conflict} userId={userId} color={view.color} />;
                            })()}

                            {/* Progress Block */}
                            {block.type === "progress" && <ProgressBlock block={block} userId={userId} />}

                            {/* Divider Block */}
                            {block.type === "divider" && <hr className="my-6 border-border" />}

                            {/* Image Block */}
                            {block.type === "image" && block.url && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={block.url} alt="View content" className="w-full rounded-lg border shadow-sm" />
                            )}

                            {/* Embed Block */}
                            {block.type === "embed" && block.url && (
                                <div className="aspect-video w-full rounded-lg overflow-hidden border shadow-sm bg-muted/50">
                                    <iframe
                                        src={block.url}
                                        className="w-full h-full"
                                        allowFullScreen
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    />
                                </div>
                            )}

                            {/* New block types */}
                            {block.type === "callout" && <CalloutBlock block={block} />}
                            {block.type === "quote" && <QuoteBlock block={block} />}
                            {block.type === "todo" && <TodoBlock block={block} />}
                            {block.type === "code" && <CodeBlock block={block} />}
                            {block.type === "statTile" && <StatTileBlock block={block} activeChips={activeChips} />}
                            {block.type === "chart" && <ChartBlock block={block} activeChips={activeChips} />}
                            {block.type === "toggle" && <ToggleBlock block={block} />}
                            {block.type === "gallery" && <GalleryBlock block={block} />}
                            {block.type === "kpiSnapshot" && <KpiSnapshotBlock block={block} />}
                            {block.type === "projectSnapshot" && <ProjectSnapshotBlock block={block} />}
                            {block.type === "assistantWorkspace" && index === firstAssistantWorkspaceIndex && (
                                <SabahWorkspaceBlock block={block} userId={userId} viewColor={view.color} viewId={view.id} />
                            )}
                            {block.type === "assistantWorkspace" && index !== firstAssistantWorkspaceIndex && (
                                <div role="note" className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                                    This view already includes a Sabah workspace. Edit the first one to keep the conversation continuous.
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {blocks.length === 0 && (
                    <div className="text-center py-16 text-muted-foreground">
                        <p>This view is empty.</p>
                        {view.isOwner && (
                            <Button asChild className="mt-4">
                                <Link href={`/views/${view.id}/edit`}>Add Blocks</Link>
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
