import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { ViewRenderer } from "@/components/view-blocks/view-renderer";
import { parseBlocksJson } from "@/lib/view-blocks";

interface PageProps {
    params: Promise<{ id: string }>;
}

async function getView(id: string, userId: string) {
    const view = await prisma.savedView.findUnique({
        where: { id },
        include: {
            owner: { select: { id: true, name: true, image: true } },
            votes: { select: { userId: true } },
            _count: { select: { votes: true } },
        },
    });

    if (!view) return null;

    // Check access
    if (view.scope === "PERSONAL" && view.ownerId !== userId) {
        return null;
    }

    return {
        ...view,
        hasVoted: view.votes.some((v) => v.userId === userId),
        voteCount: view._count.votes,
        isOwner: view.ownerId === userId,
    };
}

export default async function ViewPage({ params }: PageProps) {
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }

    const { id } = await params;
    const view = await getView(id, session.user.id);

    if (!view) {
        notFound();
    }

    const { cover, blocks } = parseBlocksJson(view.blocksJson);

    return (
        <div className="animate-fade-in">
            <ViewRenderer
                view={view}
                blocks={blocks}
                cover={cover}
                userId={session.user.id}
            />
        </div>
    );
}
