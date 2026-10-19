"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getInitials, cn } from "@/lib/utils";
import { parseMentions, renderMentionHighlights } from "@/lib/comments/mentions";
import { ReactionsBar } from "./ReactionsBar";
import type { CommentMember, TaskComment } from "./types";
import { memberLabel } from "./types";

interface CommentItemProps {
    comment: TaskComment;
    members: CommentMember[];
    viewerId: string | null;
    highlighted?: boolean;
    onVisible: (commentId: string) => void;
    onEdit: (commentId: string, text: string, mentionUserIds: string[]) => Promise<void>;
    onDelete: (commentId: string) => Promise<void>;
    onToggleReaction: (commentId: string, emoji: string) => Promise<void>;
}

function timeAgo(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "recently";
    return formatDistanceToNow(date, { addSuffix: true });
}

export function CommentItem({
    comment,
    members,
    viewerId,
    highlighted = false,
    onVisible,
    onEdit,
    onDelete,
    onToggleReaction,
}: CommentItemProps) {
    const elementRef = useRef<HTMLElement>(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(comment.body);
    const [saving, setSaving] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    useEffect(() => {
        if (!editing) setDraft(comment.body);
    }, [comment.body, editing]);

    useEffect(() => {
        const element = elementRef.current;
        if (!element) return;
        if (typeof IntersectionObserver === "undefined") {
            onVisible(comment.id);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) onVisible(comment.id);
            },
            { threshold: 0.6 },
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [comment.id, onVisible]);

    const mentionedMembers = useMemo(
        () => members.filter((member) => comment.mentionUserIds.includes(member.id)),
        [comment.mentionUserIds, members],
    );
    const canEdit = Boolean(viewerId && comment.authorId === viewerId && !comment.isDeleted);
    const authorName = comment.author ? memberLabel(comment.author) : "System";
    const highlights = useMemo(
        () => renderMentionHighlights(comment.body, mentionedMembers),
        [comment.body, mentionedMembers],
    );

    const saveEdit = async () => {
        const parsed = parseMentions(draft, members);
        if (!parsed.cleanedText || saving) return;
        setSaving(true);
        try {
            await onEdit(comment.id, parsed.cleanedText, parsed.mentionUserIds);
            setEditing(false);
        } finally {
            setSaving(false);
        }
    };

    return (
        <article ref={elementRef} id={`comment-${comment.id}`} className={cn(
            "flex gap-3 rounded-md p-2 transition-all duration-700",
            highlighted && "ring-2 ring-primary/60 bg-primary/5",
        )}>
            <Avatar className="h-8 w-8 shrink-0">
                <AvatarImage src={comment.author?.image ?? undefined} alt="" />
                <AvatarFallback className="text-[11px]">{getInitials(authorName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
                <div className="flex min-h-8 items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-sm font-medium">{authorName}</span>
                        <time className="text-xs text-muted-foreground" dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
                            {timeAgo(comment.createdAt)}
                        </time>
                        {comment.editedAt && <span className="text-xs text-muted-foreground">edited</span>}
                        {comment.isHandoverUpdate && <Badge variant="secondary" className="text-[10px]">Handover</Badge>}
                    </div>
                    {canEdit && !editing && (
                        <div className="flex shrink-0 items-center gap-0.5">
                            <Button type="button" variant="ghost" size="icon" className="relative h-7 w-7 after:absolute after:inset-[-8px] after:content-['']" aria-label="Edit comment" onClick={() => setEditing(true)}>
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="relative h-7 w-7 text-muted-foreground after:absolute after:inset-[-8px] after:content-[''] hover:text-destructive" aria-label="Delete comment" onClick={() => setConfirmingDelete(true)}>
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    )}
                </div>

                {comment.isDeleted ? (
                    <p className="mt-1 text-sm italic text-muted-foreground">deleted</p>
                ) : editing ? (
                    <div className="mt-2 space-y-2">
                        <Textarea value={draft} rows={3} disabled={saving} aria-label="Edit comment" onChange={(event) => setDraft(event.target.value)} />
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => { setDraft(comment.body); setEditing(false); }}>Cancel</Button>
                            <Button type="button" size="sm" disabled={saving || !draft.trim()} onClick={() => void saveEdit()}>{saving ? "Saving…" : "Save"}</Button>
                        </div>
                    </div>
                ) : (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                        {highlights.map((segment, index) => segment.type === "mention" ? (
                            <span key={`${segment.userId}-${index}`} className="font-medium text-primary">{segment.text}</span>
                        ) : (
                            <span key={`text-${index}`}>{segment.text}</span>
                        ))}
                    </p>
                )}

                {confirmingDelete && canEdit && (
                    <div className="mt-2 flex items-center justify-end gap-2 rounded border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-xs">
                        <span>Delete this comment?</span>
                        <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
                        <Button type="button" variant="destructive" size="sm" className="h-7" onClick={() => void onDelete(comment.id)}>Delete</Button>
                    </div>
                )}
                {!comment.isDeleted && !editing && <ReactionsBar reactions={comment.reactions} onToggle={(emoji) => onToggleReaction(comment.id, emoji)} />}
            </div>
        </article>
    );
}
