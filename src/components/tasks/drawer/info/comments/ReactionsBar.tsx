"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CommentReaction } from "./types";

const COMMON_EMOJIS = ["👍", "❤️", "🎉", "👀", "🙏", "🚀", "✅", "❗"];

interface ReactionsBarProps {
    reactions: CommentReaction[];
    onToggle: (emoji: string) => Promise<void>;
}

function ReactionRoster({ reaction, onToggle }: { reaction: CommentReaction; onToggle: (emoji: string) => Promise<void> }) {
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`${reaction.emoji} reaction by ${reaction.count} ${reaction.count === 1 ? "person" : "people"}`}
                    className={cn(
                        "relative inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs after:absolute after:inset-[-8px] after:content-[''] transition-colors",
                        reaction.reactedByMe ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-background hover:bg-muted",
                    )}
                    onMouseEnter={() => setOpen(true)}
                    onClick={() => void onToggle(reaction.emoji)}
                >
                    <span aria-hidden="true">{reaction.emoji}</span>
                    <span>{reaction.count}</span>
                </button>
            </PopoverTrigger>
            <PopoverContent
                side="top"
                align="start"
                className="w-auto min-w-36 p-2"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
            >
                <p className="mb-1 text-xs font-medium text-muted-foreground">{reaction.emoji} reacted by</p>
                <ul className="space-y-1">
                    {reaction.users.map((user) => (
                        <li key={user.id} className="text-xs">{user.name || "Unknown member"}</li>
                    ))}
                </ul>
            </PopoverContent>
        </Popover>
    );
}

export function ReactionsBar({ reactions, onToggle }: ReactionsBarProps) {
    const [pickerOpen, setPickerOpen] = useState(false);
    return (
        <div className="mt-2 flex flex-wrap items-center gap-1" aria-label="Reactions">
            {reactions.map((reaction) => (
                <ReactionRoster key={reaction.emoji} reaction={reaction} onToggle={onToggle} />
            ))}
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" className="relative h-7 w-7 rounded-full after:absolute after:inset-[-8px] after:content-['']" aria-label="Add reaction">
                        <Plus className="h-3.5 w-3.5" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-44 p-2">
                    <div className="grid grid-cols-4 gap-1" aria-label="Emoji picker">
                        {COMMON_EMOJIS.map((emoji) => (
                            <Button
                                key={emoji}
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="relative h-8 w-8 text-base after:absolute after:inset-[-6px] after:content-['']"
                                aria-label={`React with ${emoji}`}
                                onClick={() => {
                                    setPickerOpen(false);
                                    void onToggle(emoji);
                                }}
                            >
                                {emoji}
                            </Button>
                        ))}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
