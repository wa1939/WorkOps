"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Pin, Trash2 } from "lucide-react";
import { getInitials, formatDate } from "@/lib/utils";

interface NoteCardProps {
    note: {
        id: string;
        title: string;
        body: string;
        isPinned?: boolean;
        color?: string;
        isShared: boolean;
        updatedAt: string | Date;
        author: { name: string; image: string | null } | null;
        tags: Array<{ id: string; tag: { name: string; color: string } }>;
    };
    isOwner: boolean;
}

const colorAccent: Record<string, string> = {
    default: "note-accent-default",
    blue: "note-accent-blue",
    green: "note-accent-green",
    purple: "note-accent-purple",
    pink: "note-accent-pink",
    yellow: "note-accent-yellow",
    orange: "note-accent-orange",
};

export function NoteCard({ note, isOwner }: NoteCardProps) {
    const router = useRouter();
    const [deleting, setDeleting] = useState(false);

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const res = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
            if (res.ok) {
                router.refresh();
            }
        } catch {
            // silent
        } finally {
            setDeleting(false);
        }
    };

    const accent = colorAccent[note.color || "default"] || colorAccent.default;
    const preview = note.body.replace(/[#*`>_]/g, "").slice(0, 240);

    return (
        <Card
            variant="elevated"
            className={`h-full relative group ${accent} transition-all hover:-translate-y-0.5 hover:shadow-lg overflow-hidden`}
        >
            {/* Subtle accent stripe on the top */}
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/0 via-primary/40 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity" />

            {note.isPinned && (
                <Pin className="absolute top-3 right-3 h-3.5 w-3.5 text-primary rotate-45 drop-shadow" />
            )}

            <Link href={`/notes/${note.id}`} className="block">
                <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold line-clamp-2 leading-snug pr-6">
                        {note.title || <span className="italic text-muted-foreground">Untitled</span>}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pb-3">
                    <p className="text-[13px] text-muted-foreground line-clamp-4 leading-relaxed">
                        {preview}{note.body.length > 240 ? "…" : ""}
                    </p>

                    {note.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {note.tags.slice(0, 3).map((tt) => (
                                <Badge
                                    key={tt.id}
                                    variant="secondary"
                                    className="text-[10px] px-1.5 py-0 font-medium"
                                    style={{ backgroundColor: tt.tag.color + "22", color: tt.tag.color, borderColor: tt.tag.color + "33" }}
                                >
                                    {tt.tag.name}
                                </Badge>
                            ))}
                            {note.tags.length > 3 && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                                    +{note.tags.length - 3}
                                </Badge>
                            )}
                        </div>
                    )}
                </CardContent>
            </Link>

            <div className="flex items-center justify-between px-6 pb-3 pt-1 gap-2 text-[11px] text-muted-foreground/80">
                <div className="flex items-center gap-2 min-w-0">
                    {note.author && (
                        <>
                            <Avatar className="h-5 w-5">
                                <AvatarImage src={note.author.image || ""} />
                                <AvatarFallback className="text-[9px]">{getInitials(note.author.name)}</AvatarFallback>
                            </Avatar>
                            <span className="truncate">{note.author.name.split(" ")[0]}</span>
                        </>
                    )}
                    <span className="text-muted-foreground/50">·</span>
                    <span className="truncate">{formatDate(note.updatedAt)}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {!note.isShared && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Private</span>
                    )}
                    {isOwner && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Delete note?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will permanently delete &ldquo;{note.title}&rdquo;. This action cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                                        Delete
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                </div>
            </div>
        </Card>
    );
}
