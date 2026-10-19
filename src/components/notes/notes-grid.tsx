"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Tag, Pin } from "lucide-react";
import { NoteCard } from "@/components/notes/note-card";

interface Note {
    id: string;
    title: string;
    body: string;
    isPinned?: boolean;
    color?: string;
    isShared: boolean;
    authorId: string | null;
    updatedAt: string;
    author: { name: string; image: string | null } | null;
    tags: Array<{ id: string; tag: { name: string; color: string } }>;
}

export function NotesGrid({
    notes,
    currentUserId,
    allTags,
}: {
    notes: Note[];
    currentUserId: string;
    allTags: string[];
}) {
    const [search, setSearch] = useState("");
    const [activeTag, setActiveTag] = useState<string | null>(null);

    const filtered = notes.filter((note) => {
        const matchesSearch =
            !search ||
            note.title.toLowerCase().includes(search.toLowerCase()) ||
            note.body.toLowerCase().includes(search.toLowerCase());

        const matchesTag =
            !activeTag || note.tags.some((t) => t.tag.name === activeTag);

        return matchesSearch && matchesTag;
    });

    const pinned = filtered.filter((n) => n.isPinned);
    const unpinned = filtered.filter((n) => !n.isPinned);

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                <div className="relative max-w-md flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search notes..."
                        className="pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                {/* Tag rail: swipeable on phones so tags never wrap into a wall */}
                <div className="scroll-touch edge-fade -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                    {allTags.slice(0, 8).map((tag) => (
                        <Badge
                            key={tag}
                            variant={activeTag === tag ? "default" : "outline"}
                            className="shrink-0 cursor-pointer py-1.5 hover:bg-accent"
                            onClick={() =>
                                setActiveTag(activeTag === tag ? null : tag)
                            }
                        >
                            <Tag className="h-3 w-3 mr-1" />
                            {tag}
                        </Badge>
                    ))}
                </div>
            </div>

            {pinned.length > 0 && (
                <div>
                    <div className="mb-3 flex items-center gap-2">
                        <Pin className="h-4 w-4 rotate-45 text-primary" />
                        <h2 className="text-sm font-medium text-muted-foreground">Pinned</h2>
                    </div>
                    <div className="grid grid-cols-2 gap-3 animate-stagger-in md:grid-cols-2 md:gap-4 lg:grid-cols-3">
                        {pinned.map((note) => (
                            <NoteCard
                                key={note.id}
                                note={note}
                                isOwner={note.authorId === currentUserId}
                            />
                        ))}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 animate-stagger-in md:gap-4 lg:grid-cols-3">
                {unpinned.map((note) => (
                    <NoteCard
                        key={note.id}
                        note={note}
                        isOwner={note.authorId === currentUserId}
                    />
                ))}
            </div>

            {filtered.length === 0 && (
                <p className="py-8 text-center text-muted-foreground">
                    No notes match your search.
                </p>
            )}
        </div>
    );
}
