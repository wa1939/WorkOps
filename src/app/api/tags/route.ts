import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const tagSchema = z.object({
    name: z.string().min(1),
    color: z.string().optional(),
});

// Generate random color
function randomColor() {
    const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];
    return colors[Math.floor(Math.random() * colors.length)];
}

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const tags = await prisma.tag.findMany({
            orderBy: { name: "asc" },
        });

        return NextResponse.json(tags);
    } catch (error) {
        console.error("GET /api/tags error:", error);
        return NextResponse.json({ error: "Failed to fetch tags" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const data = tagSchema.parse(body);

        // Check if tag already exists
        const existing = await prisma.tag.findUnique({
            where: { name: data.name },
        });

        if (existing) {
            return NextResponse.json(existing);
        }

        const tag = await prisma.tag.create({
            data: {
                name: data.name,
                color: data.color || randomColor(),
            },
        });

        return NextResponse.json(tag, { status: 201 });
    } catch (error) {
        console.error("POST /api/tags error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
    }
}
