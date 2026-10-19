"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TaskDrawerPayload } from "../types";
import { Button } from "@/components/ui/button";
import { CommentComposer } from "./comments/CommentComposer";
import { CommentItem } from "./comments/CommentItem";
import type { CommentMember, TaskComment } from "./comments/types";

interface CommentsSectionProps {
    task: TaskDrawerPayload;
    commentId?: string | null;
}

type CommentsPage = {
    comments: TaskComment[];
    nextCursor: string | null;
    viewerId?: string;
};

function initialComment(taskId: string, comment: TaskDrawerPayload["comments"][number]): TaskComment {
    return {
        id: comment.id,
        taskId,
        body: comment.body,
        authorId: comment.author?.id ?? null,
        author: comment.author,
        mentionUserIds: [],
        createdAt: comment.createdAt,
        editedAt: null,
        deletedAt: null,
        isDeleted: false,
        isHandoverUpdate: false,
        myReadAt: null,
        reactions: [],
    };
}

function normalizeComment(taskId: string, comment: TaskComment): TaskComment {
    return {
        ...comment,
        taskId: comment.taskId ?? taskId,
        author: comment.author ? {
            ...comment.author,
            name: comment.author.name ?? null,
        } : null,
        mentionUserIds: Array.isArray(comment.mentionUserIds) ? comment.mentionUserIds : [],
        editedAt: comment.editedAt ?? null,
        deletedAt: comment.deletedAt ?? null,
        isDeleted: comment.isDeleted ?? Boolean(comment.deletedAt),
        myReadAt: comment.myReadAt ?? null,
        reactions: Array.isArray(comment.reactions) ? comment.reactions : [],
    };
}

function errorFromResponse(body: unknown): string {
    if (body && typeof body === "object" && "error" in body) {
        const value = (body as { error?: unknown }).error;
        if (typeof value === "string") return value;
    }
    return "Could not update comments";
}

export function CommentsSection({ task, commentId = null }: CommentsSectionProps) {
    const members = useMemo<CommentMember[]>(() => {
        const seen = new Set<string>();
        return (task.project?.members ?? [])
            .map(({ user, userId }) => ({
                id: user?.id ?? userId,
                name: user?.name ?? null,
                email: user?.email ?? null,
                image: user?.image ?? null,
            }))
            .filter((member) => {
                if (!member.id || seen.has(member.id)) return false;
                seen.add(member.id);
                return true;
            });
    }, [task.project?.members]);
    const [comments, setComments] = useState<TaskComment[]>(() => task.comments.map((comment) => initialComment(task.id, comment)));
    const [viewerId, setViewerId] = useState<string | null>(null);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [highlightPhase, setHighlightPhase] = useState<"active" | "fading" | null>(null);
    const readIds = useRef(new Set<string>());

    const fetchPage = useCallback(async (cursor: string | null, signal?: AbortSignal): Promise<CommentsPage> => {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/comments${query}`, {
            cache: "no-store",
            signal,
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorFromResponse(body));
        return body as CommentsPage;
    }, [task.id]);

    useEffect(() => {
        const controller = new AbortController();
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const loaded: TaskComment[] = [];
                let cursor: string | null = null;
                let pageNumber = 0;
                let page: CommentsPage;
                do {
                    page = await fetchPage(cursor, controller.signal);
                    loaded.push(...page.comments.map((comment) => normalizeComment(task.id, comment)));
                    cursor = page.nextCursor;
                    pageNumber += 1;
                } while (
                    Boolean(commentId)
                    && !loaded.some((comment) => comment.id === commentId)
                    && Boolean(cursor)
                    && pageNumber < 20
                );
                if (cancelled) return;
                const unique = new Map(loaded.map((comment) => [comment.id, comment]));
                const fetchedComments = Array.from(unique.values());
                setComments(fetchedComments);
                setNextCursor(cursor);
                setViewerId(page.viewerId ?? null);
                readIds.current = new Set(fetchedComments.filter((comment) => comment.myReadAt).map((comment) => comment.id));
            } catch (cause) {
                if (cancelled || (cause instanceof DOMException && cause.name === "AbortError")) return;
                setError(cause instanceof Error ? cause.message : "Could not load comments");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [commentId, fetchPage, task.id]);

    useEffect(() => {
        if (!commentId || loading) return;
        const element = document.getElementById(`comment-${commentId}`);
        if (!element) return;
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightPhase("active");
        const fadeTimer = window.setTimeout(() => setHighlightPhase("fading"), 1_400);
        const clearTimer = window.setTimeout(() => setHighlightPhase(null), 2_200);
        return () => {
            window.clearTimeout(fadeTimer);
            window.clearTimeout(clearTimer);
        };
    }, [commentId, comments.length, loading]);

    const loadMore = async () => {
        if (!nextCursor || loadingMore) return;
        setLoadingMore(true);
        try {
            const page = await fetchPage(nextCursor);
            setComments((previous) => {
                const byId = new Map(previous.map((comment) => [comment.id, comment]));
                for (const comment of page.comments) byId.set(comment.id, normalizeComment(task.id, comment));
                return Array.from(byId.values());
            });
            setNextCursor(page.nextCursor);
            if (page.viewerId) setViewerId(page.viewerId);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not load more comments");
        } finally {
            setLoadingMore(false);
        }
    };

    const markVisible = useCallback((commentIdToRead: string) => {
        if (readIds.current.has(commentIdToRead)) return;
        readIds.current.add(commentIdToRead);
        const readAt = new Date().toISOString();
        setComments((previous) => previous.map((comment) => comment.id === commentIdToRead ? { ...comment, myReadAt: readAt } : comment));
        void fetch(`/api/tasks/${encodeURIComponent(task.id)}/comments/read`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ commentIds: [commentIdToRead] }),
        }).then((response) => {
            if (!response.ok) throw new Error("Read receipt failed");
        }).catch(() => {
            readIds.current.delete(commentIdToRead);
            setComments((previous) => previous.map((comment) => comment.id === commentIdToRead ? { ...comment, myReadAt: null } : comment));
        });
    }, [task.id]);

    const addComment = async (text: string, mentionUserIds: string[]) => {
        setError(null);
        const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/comments`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text, mentionUserIds }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            const message = errorFromResponse(body);
            setError(message);
            throw new Error(message);
        }
        const created = normalizeComment(task.id, body as TaskComment);
        setComments((previous) => [...previous, created]);
        setViewerId((previous) => previous ?? created.authorId);
    };

    const editComment = async (commentToEdit: string, text: string, mentionUserIds: string[]) => {
        const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/comments/${encodeURIComponent(commentToEdit)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text, mentionUserIds }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            const message = errorFromResponse(body);
            setError(message);
            throw new Error(message);
        }
        const updated = normalizeComment(task.id, body as TaskComment);
        setComments((previous) => previous.map((comment) => comment.id === updated.id ? updated : comment));
    };

    const deleteComment = async (commentToDelete: string) => {
        const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/comments/${encodeURIComponent(commentToDelete)}`, { method: "DELETE" });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            const message = errorFromResponse(body);
            setError(message);
            throw new Error(message);
        }
        const deleted = normalizeComment(task.id, body as TaskComment);
        setComments((previous) => previous.map((comment) => comment.id === deleted.id ? deleted : comment));
    };

    const toggleReaction = async (commentToUpdate: string, emoji: string) => {
        const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/comments/${encodeURIComponent(commentToUpdate)}/reactions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ emoji }),
        });
        const body = await response.json().catch(() => null) as { reactions?: TaskComment["reactions"]; error?: string } | null;
        if (!response.ok) {
            setError(body?.error ?? "Could not update reaction");
            return;
        }
        setComments((previous) => previous.map((comment) => comment.id === commentToUpdate
            ? { ...comment, reactions: body?.reactions ?? comment.reactions }
            : comment));
    };

    const firstUnreadIndex = comments.findIndex((comment) => comment.myReadAt === null);

    return (
        <section id="comments" aria-label="Comments" className="scroll-mt-24 rounded-md border border-border/70 bg-card/20 p-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Comments</h3>
                <span className="text-xs text-muted-foreground">{comments.length}</span>
            </div>
            <div className="sticky bottom-0 z-10 -mx-3 mt-3 border-t border-border/70 bg-card/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-card/80">
                <CommentComposer members={members} disabled={loading} onSubmit={addComment} />
            </div>
            {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
            {loading && <p className="mt-4 text-center text-xs text-muted-foreground">Loading comments…</p>}
            {!loading && comments.length === 0 && <p className="mt-4 text-center text-sm text-muted-foreground">No comments yet. Start the conversation.</p>}
            <div className="mt-3 space-y-1">
                {comments.map((comment, index) => (
                    <div key={comment.id}>
                        {index === firstUnreadIndex && (
                            <div role="separator" aria-label="New comments" className="my-3 flex items-center gap-2 text-[11px] font-medium text-primary">
                                <span className="h-px flex-1 bg-primary/30" />
                                <span>New</span>
                                <span className="h-px flex-1 bg-primary/30" />
                            </div>
                        )}
                        <CommentItem
                            comment={comment}
                            members={members}
                            viewerId={viewerId}
                            highlighted={comment.id === commentId && highlightPhase !== null}
                            onVisible={markVisible}
                            onEdit={editComment}
                            onDelete={deleteComment}
                            onToggleReaction={toggleReaction}
                        />
                    </div>
                ))}
            </div>
            {nextCursor && (
                <div className="mt-3 flex justify-center">
                    <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
                        {loadingMore ? "Loading…" : "Load more comments"}
                    </Button>
                </div>
            )}
        </section>
    );
}
