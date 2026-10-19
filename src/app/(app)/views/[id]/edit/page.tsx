import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { BlockEditor } from "@/components/view-blocks/block-editor";
import { parseBlocksJson } from "@/lib/view-blocks";

interface PageProps {
    params: Promise<{ id: string }>;
}

async function getView(id: string, userId: string) {
    const view = await prisma.savedView.findUnique({
        where: { id },
        include: {
            owner: { select: { id: true, name: true, image: true } },
        },
    });

    if (!view) return null;

    // Only owner can edit
    if (view.ownerId !== userId) {
        return null;
    }

    return view;
}

export default async function EditViewPage({ params }: PageProps) {
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
            <BlockEditor
                viewId={view.id}
                viewName={view.name}
                viewColor={view.color}
                viewIcon={view.icon}
                initialBlocks={blocks}
                initialCover={cover}
            />
        </div>
    );
}
