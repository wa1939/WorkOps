"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Send, Loader2, AtSign } from "lucide-react";
import { formatRelativeDate, getInitials } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface Comment {
    id: string;
    body: string;
    createdAt: string;
    isHandoverUpdate: boolean;
    author: {
        id: string;
        name: string;
        image: string | null;
    } | null;
}

interface User {
    id: string;
    name: string;
}

interface TaskCommentsProps {
    taskId: string;
    comments: Comment[];
    users: User[];
}

export function TaskComments({ taskId, comments: initialComments, users }: TaskCommentsProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [comments, setComments] = useState(initialComments);
    const [body, setBody] = useState("");
    const [sending, setSending] = useState(false);
    const [showMentions, setShowMentions] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!body.trim()) return;

        setSending(true);
        try {
            const res = await fetch(`/api/tasks/${taskId}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ body }),
            });

            if (res.ok) {
                const newComment = await res.json();
                setComments((prev) => [newComment, ...prev]);
                setBody("");
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to add comment", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
        } finally {
            setSending(false);
        }
    };

    const insertMention = (user: User) => {
        setBody((prev) => prev + `@${user.name} `);
        setShowMentions(false);
    };

    const highlightMentions = (text: string) => {
        // Match @Username patterns
        const mentionPattern = /@(\w+(?:\s+\w+)?)/g;
        const parts = text.split(mentionPattern);

        return parts.map((part, i) => {
            // Every odd index is a mention
            if (i % 2 === 1) {
                return (
                    <span key={i} className="text-primary font-medium">
                        @{part}
                    </span>
                );
            }
            return part;
        });
    };

    return (
        <div className="space-y-4">
            {/* Comment Form */}
            <form onSubmit={handleSubmit} className="flex gap-2">
                <div className="flex-1 relative">
                    <Textarea
                        placeholder="Add a comment... Use @ to mention someone"
                        value={body}
                        onChange={(e) => {
                            setBody(e.target.value);
                            // Show mentions dropdown when @ is typed
                            if (e.target.value.endsWith("@")) {
                                setShowMentions(true);
                            }
                        }}
                        rows={2}
                        className="resize-none"
                    />
                    {showMentions && (
                        <div className="absolute bottom-full left-0 mb-1 bg-popover border rounded-md shadow-lg p-1 w-48 z-50">
                            {users.map((user) => (
                                <button
                                    key={user.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded"
                                    onClick={() => insertMention(user)}
                                >
                                    @{user.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex flex-col gap-1">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button type="button" variant="outline" size="icon">
                                <AtSign className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {users.map((user) => (
                                <DropdownMenuItem key={user.id} onClick={() => insertMention(user)}>
                                    @{user.name}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button type="submit" size="icon" disabled={sending || !body.trim()}>
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                </div>
            </form>

            {/* Comments List */}
            <div className="space-y-4">
                {comments.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                        No comments yet. Be the first to add one!
                    </p>
                ) : (
                    comments.map((comment) => (
                        <div key={comment.id} className="flex gap-3">
                            <Avatar className="h-8 w-8">
                                <AvatarImage src={comment.author?.image || ""} />
                                <AvatarFallback className="text-xs">
                                    {getInitials(comment.author?.name || "?")}
                                </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">
                                        {comment.author?.name || "System"}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {formatRelativeDate(new Date(comment.createdAt))}
                                    </span>
                                    {comment.isHandoverUpdate && (
                                        <Badge variant="secondary" className="text-xs">Handover</Badge>
                                    )}
                                </div>
                                <p className="text-sm mt-1">{highlightMentions(comment.body)}</p>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
