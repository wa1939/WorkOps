import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";

export const dynamic = 'force-dynamic';

const updateSchema = z.object({
    name: z.string().min(1).optional(),
    title: z.string().optional().nullable(),
    timezone: z.string().optional(),
    capacityPerWeekHours: z.number().min(0).max(60).optional(),
    quietUntil: z.string().datetime().nullable().optional(),
});

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: {
                id: true,
                name: true,
                email: true,
                title: true,
                image: true,
                role: true,
                timezone: true,
                capacityPerWeekHours: true,
                quietUntil: true,
            },
        });

        return NextResponse.json(user);
    } catch (error) {
        console.error("GET /api/users/me error:", error);
        return NextResponse.json({ error: "Failed to fetch user" }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const data = updateSchema.parse(body);

        const user = await prisma.user.update({
            where: { id: session.user.id },
            data: {
                name: data.name,
                title: data.title,
                timezone: data.timezone,
                capacityPerWeekHours: data.capacityPerWeekHours,
                quietUntil: data.quietUntil === undefined
                    ? undefined
                    : data.quietUntil === null
                        ? null
                        : new Date(data.quietUntil),
            },
        });

        return NextResponse.json(user);
    } catch (error) {
        console.error("PUT /api/users/me error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }
}
