import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Plus, StickyNote, Link2, Sparkles } from "lucide-react";
import Link from "next/link";
import { NotesGrid } from "@/components/notes/notes-grid";
import { EmptyState } from "@/components/ui/empty-state";

async function getNotes(userId: string) {
    const notes = await prisma.notePage.findMany({
        where: {
            OR: [
                { isShared: true },
                { authorId: userId },
            ],
        },
        include: {
            author: true,
            tags: { include: { tag: true } },
        },
        orderBy: [
            { isPinned: "desc" },
            { updatedAt: "desc" },
        ],
    });

    return notes;
}

export default async function NotesPage() {
    const session = await auth();
    if (!session?.user) return null;

    const notes = await getNotes(session.user.id);

    const allTags = new Set<string>();
    notes.forEach((note) => {
        note.tags.forEach((t) => allTags.add(t.tag.name));
    });

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Notes</h1>
                    <p className="text-sm text-muted-foreground">Knowledge base and documentation</p>
                </div>
                <Button asChild className="max-sm:w-full">
                    <Link href="/notes/new">
                        <Plus className="mr-2 h-4 w-4" />
                        New Note
                    </Link>
                </Button>
            </div>

            {notes.length === 0 ? (
                <EmptyState
                    icon={StickyNote}
                    title="No notes yet"
                    description="Notes are the department's shared brain — meeting minutes, decisions, links, and quick jots. Start one below."
                    actions={[
                        { label: "Start a new note", href: "/notes/new", icon: Plus, variant: "primary" },
                        { label: "Paste a link", href: "/notes/new?type=link", icon: Link2, variant: "secondary" },
                        { label: "Ask Sabah to draft one", href: "/notes/new?ai=1", icon: Sparkles, variant: "secondary" },
                    ]}
                />
            ) : (
                <NotesGrid
                    notes={JSON.parse(JSON.stringify(notes))}
                    currentUserId={session.user.id}
                    allTags={Array.from(allTags)}
                />
            )}
        </div>
    );
}
