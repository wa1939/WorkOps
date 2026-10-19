"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2, Sparkles, Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { SabahAvatar } from "@/components/sabah/sabah-avatar";

interface SavedView {
    id: string;
    name: string;
    icon?: string | null;
    color?: string | null;
    scope: "PERSONAL" | "TEAM";
    ownerId: string | null;
    owner?: { id: string; name: string | null } | null;
}

interface CurrentUserHint {
    userId: string | null;
}

export const SAVED_VIEWS_REFRESH_EVENT = "saved-views:refresh";

const COLOR_DOTS: Record<string, string> = {
    blue: "bg-blue-500",
    green: "bg-emerald-500",
    purple: "bg-violet-500",
    orange: "bg-orange-500",
    red: "bg-red-500",
    pink: "bg-pink-500",
    cyan: "bg-cyan-500",
    yellow: "bg-yellow-500",
};

export function SavedViewsList() {
    const pathname = usePathname();
    const router = useRouter();
    const { toast } = useToast();
    const [views, setViews] = useState<SavedView[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [toDelete, setToDelete] = useState<SavedView | null>(null);
    const [query, setQuery] = useState("");
    const [expandedTeam, setExpandedTeam] = useState(true);

    const fetchViews = useCallback(async () => {
        try {
            const [viewsRes, meRes] = await Promise.all([
                fetch("/api/saved-views"),
                fetch("/api/users/me"),
            ]);

            if (viewsRes.ok) {
                const data = (await viewsRes.json()) as SavedView[];
                setViews(data);
            }
            if (meRes.ok) {
                const me = (await meRes.json()) as CurrentUserHint | { id?: string };
                const uid = (me as { id?: string }).id ?? (me as CurrentUserHint).userId ?? null;
                setCurrentUserId(uid);
            }
        } catch (error) {
            console.error("Failed to fetch saved views", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchViews();
    }, [fetchViews]);

    useEffect(() => {
        const handler = () => fetchViews();
        window.addEventListener(SAVED_VIEWS_REFRESH_EVENT, handler);
        return () => window.removeEventListener(SAVED_VIEWS_REFRESH_EVENT, handler);
    }, [fetchViews]);

    const handleDelete = async () => {
        if (!toDelete) return;
        setDeleting(toDelete.id);
        try {
            const res = await fetch(`/api/saved-views/${toDelete.id}`, { method: "DELETE" });
            if (res.ok) {
                setViews((prev) => prev.filter((v) => v.id !== toDelete.id));
                toast({
                    title: "View deleted",
                    description: `"${toDelete.name}" was removed.`,
                    variant: "success",
                });
                if (pathname === `/views/${toDelete.id}` || pathname === `/views/${toDelete.id}/edit`) {
                    router.push("/");
                }
            } else {
                const data = await res.json().catch(() => null);
                toast({
                    title: "Error",
                    description: data?.error ?? "Failed to delete view",
                    variant: "destructive",
                });
            }
        } catch {
            toast({ title: "Error", description: "Failed to delete view", variant: "destructive" });
        } finally {
            setDeleting(null);
            setToDelete(null);
        }
    };

    if (loading) {
        return (
            <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading views…
            </div>
        );
    }

    if (views.length === 0) {
        return (
            <div className="px-3 py-3">
                <Link
                    href="/views/new"
                    className="block w-full rounded-lg border border-dashed border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-fuchsia-500/5 p-3 text-center transition-all hover:border-violet-500/50 hover:from-violet-500/10"
                >
                    <Sparkles className="h-4 w-4 text-violet-400 mx-auto mb-1" />
                    <p className="text-xs font-medium text-foreground">Create your first view</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Pick from 6 polished templates</p>
                </Link>
            </div>
        );
    }

    const q = query.trim().toLowerCase();
    const filtered = q ? views.filter((v) => v.name.toLowerCase().includes(q)) : views;

    const mine = filtered.filter((v) => v.ownerId === currentUserId);
    const team = filtered.filter((v) => v.ownerId !== currentUserId);

    const showSearch = views.length > 5;

    return (
        <>
            {showSearch && (
                <div className="px-3 pb-1">
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Filter…"
                            className="h-7 pl-7 text-xs"
                        />
                    </div>
                </div>
            )}

            {mine.length > 0 && (
                <div className="space-y-0.5">
                    <SectionHeader label="My Views" count={mine.length} />
                    {mine.map((v) => (
                        <ViewRow
                            key={v.id}
                            view={v}
                            pathname={pathname}
                            isOwner
                            onDelete={() => setToDelete(v)}
                        />
                    ))}
                </div>
            )}

            {team.length > 0 && (
                <div className="space-y-0.5 mt-2">
                    <button
                        type="button"
                        onClick={() => setExpandedTeam(!expandedTeam)}
                        className="flex items-center justify-between px-3 py-1 w-full text-left text-[10px] uppercase tracking-wider text-muted-foreground font-medium hover:text-foreground transition-colors"
                    >
                        <span>Team Views · {team.length}</span>
                        <ChevronDown className={cn("h-3 w-3 transition-transform", !expandedTeam && "-rotate-90")} />
                    </button>
                    {expandedTeam && team.map((v) => (
                        <ViewRow
                            key={v.id}
                            view={v}
                            pathname={pathname}
                            isOwner={false}
                            onDelete={() => setToDelete(v)}
                        />
                    ))}
                </div>
            )}

            {filtered.length === 0 && q && (
                <p className="px-3 py-2 text-xs text-muted-foreground italic">No matches for "{query}"</p>
            )}

            <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this view?</AlertDialogTitle>
                        <AlertDialogDescription>
                            &quot;{toDelete?.name}&quot; will be permanently removed. This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            disabled={deleting !== null}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
    return (
        <div className="flex items-center justify-between px-3 py-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                {label} · {count}
            </span>
        </div>
    );
}

function ViewRow({
    view,
    pathname,
    isOwner,
    onDelete,
}: {
    view: SavedView;
    pathname: string;
    isOwner: boolean;
    onDelete: () => void;
}) {
    const isActive = pathname === `/views/${view.id}` || pathname === `/views/${view.id}/edit`;
    const dot = COLOR_DOTS[view.color ?? "blue"] ?? COLOR_DOTS.blue;

    return (
        <div
            className={cn(
                "group relative flex items-center rounded-lg transition-all",
                isActive ? "bg-primary/10" : "hover:bg-accent",
            )}
        >
            <Link
                href={`/views/${view.id}`}
                className={cn(
                    "flex-1 flex items-center gap-2.5 px-3 py-1.5 text-sm min-w-0",
                    isActive ? "text-primary font-medium" : "text-muted-foreground",
                )}
            >
                {view.icon === "sabah" ? (
                    <SabahAvatar size="sm" />
                ) : view.icon ? (
                    <span className="text-sm flex-shrink-0">{view.icon}</span>
                ) : (
                    <span className={cn("h-2 w-2 rounded-full flex-shrink-0", dot)} />
                )}
                <span className="truncate">{view.name}</span>
            </Link>

            {isOwner && (
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-inherit pl-1">
                    <Link
                        href={`/views/${view.id}/edit`}
                        className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground"
                        title="Edit"
                    >
                        <Pencil className="h-3 w-3" />
                    </Link>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onDelete();
                        }}
                        className="p-1 rounded hover:bg-background text-muted-foreground hover:text-red-500"
                        title="Delete"
                    >
                        <Trash2 className="h-3 w-3" />
                    </button>
                </div>
            )}
        </div>
    );
}
