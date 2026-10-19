import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;

        const conversation = await prisma.aiConversation.findUnique({
            where: { id },
            include: {
                messages: {
                    orderBy: { createdAt: "asc" },
                },
            },
        });

        if (!conversation) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        if (conversation.userId !== session.user.id) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        return NextResponse.json({
            id: conversation.id,
            title: conversation.title,
            createdAt: conversation.createdAt.toISOString(),
            updatedAt: conversation.updatedAt.toISOString(),
            messages: conversation.messages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                toolCalls: m.toolCallsJson ? JSON.parse(m.toolCallsJson) : null,
                toolCallId: m.toolCallId,
                createdAt: m.createdAt.toISOString(),
            })),
        });
    } catch (error) {
        console.error("GET /api/ai/conversations/[id] error:", error);
        return NextResponse.json({ error: "Failed to load conversation" }, { status: 500 });
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;

        const conv = await prisma.aiConversation.findUnique({
            where: { id },
            select: { userId: true },
        });

        if (!conv) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        if (conv.userId !== session.user.id) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        await prisma.aiConversation.delete({ where: { id } });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("DELETE /api/ai/conversations/[id] error:", error);
        return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
    }
}
