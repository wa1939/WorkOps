import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";

const putSchema = z.object({
    key: z.string().min(1).max(64),
    value: z.string().max(4096),
});

export async function GET() {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
        return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    const rows = await prisma.appConfig.findMany({ orderBy: { key: "asc" } });
    return NextResponse.json({ config: rows });
}

export async function PUT(request: Request) {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
        return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    try {
        const { key, value } = putSchema.parse(await request.json());
        const row = await prisma.appConfig.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });
        return NextResponse.json({ ok: true, config: row });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message || "Invalid" }, { status: 400 });
    }
}
