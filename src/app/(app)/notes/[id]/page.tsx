import { getNoteForActor } from "@/lib/notes/commands";
import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Edit, Tag, Pin } from "lucide-react";
import Link from "next/link";
import { formatDate, getInitials } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

async function getNote(id: string, actor: any) {
    const note = await getNoteForActor(id, actor);


    return note;
}

export default async function NoteDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await auth();
    if (!session?.user) return null;

    const { id } = await params;
    let note;
    try { note = await getNote(id, { id: session.user.id, role: session.user.role, departmentIds: [] }); } catch { notFound(); }

    if (!note) {
        notFound();
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="mb-6 flex items-center justify-between">
                <Button variant="ghost" asChild>
                    <Link href="/notes">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Notes
                    </Link>
                </Button>
                {note.authorId === session.user.id && (
                    <Button asChild>
                        <Link href={`/notes/${id}/edit`}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                        </Link>
                    </Button>
                )}
            </div>

            {/* Header */}
            <div className="mb-6">
                <div className="flex items-center gap-2">
                    <h1 className="text-3xl font-bold">{note.title}</h1>
                    {note.isPinned && <Pin className="h-5 w-5 text-primary rotate-45" />}
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    {note.author && (
                        <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                                <AvatarImage src={note.author.image || ""} />
                                <AvatarFallback className="text-xs">{getInitials(note.author.name)}</AvatarFallback>
                            </Avatar>
                            <span>{note.author.name}</span>
                        </div>
                    )}
                    <span>•</span>
                    <span>Updated {formatDate(note.updatedAt)}</span>
                    <span>•</span>
                    <Badge variant="outline">{note.isShared ? "Shared" : "Private"}</Badge>
                </div>
            </div>

            {/* Tags */}
            {note.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6">
                    {note.tags.map((tt: { id: string; tag: { color: string; name: string } }) => (
                        <Badge
                            key={tt.id}
                            variant="secondary"
                            style={{ backgroundColor: tt.tag.color + "20", color: tt.tag.color }}
                        >
                            <Tag className="h-3 w-3 mr-1" />
                            {tt.tag.name}
                        </Badge>
                    ))}
                </div>
            )}

            {/* Content */}
            <Card>
                <CardContent className="pt-6 prose prose-neutral dark:prose-invert max-w-none">
                    <ReactMarkdown>{note.body}</ReactMarkdown>
                </CardContent>
            </Card>
        </div>
    );
}
