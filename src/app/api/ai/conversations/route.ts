import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        let conversations;
        try {
            conversations = await prisma.aiConversation.findMany({
                where: { userId: session.user.id },
                select: {
                    id: true,
                    title: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: { select: { messages: true } },
                },
                orderBy: { updatedAt: "desc" },
                take: 50,
            });
        } catch (dbErr) {
            // Tables not yet created (migration not applied) — return empty list
            console.warn("AiConversation table unavailable:", (dbErr as Error).message);
            return NextResponse.json([]);
        }

        return NextResponse.json(
            conversations.map((c) => ({
                id: c.id,
                title: c.title,
                createdAt: c.createdAt.toISOString(),
                updatedAt: c.updatedAt.toISOString(),
                messageCount: c._count.messages,
            })),
        );
    } catch (error) {
        console.error("GET /api/ai/conversations error:", error);
        return NextResponse.json({ error: "Failed to load conversations" }, { status: 500 });
    }
}

const createSchema = z.object({
    title: z.string().max(200).optional(),
});

export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const parsed = createSchema.parse(body);

        const conv = await prisma.aiConversation.create({
            data: {
                userId: session.user.id,
                title: parsed.title ?? null,
            },
        });

        return NextResponse.json({ id: conv.id, title: conv.title, createdAt: conv.createdAt.toISOString() });
    } catch (error) {
        console.error("POST /api/ai/conversations error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
        }
        return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });
    }
}
