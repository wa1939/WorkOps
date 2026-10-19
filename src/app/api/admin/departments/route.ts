import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";

const departmentSchema = z.object({
    name: z.string().min(1, "Department name is required"),
});

export async function GET() {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const departments = await prisma.department.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });

    return NextResponse.json(departments);
}

export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== "ADMIN") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = await request.json();
        const data = departmentSchema.parse(body);

        const existing = await prisma.department.findUnique({
            where: { name: data.name },
        });
        if (existing) {
            return NextResponse.json({ error: "Department already exists" }, { status: 409 });
        }

        const department = await prisma.department.create({
            data: { name: data.name },
        });

        return NextResponse.json(department, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
        }
        console.error("POST /api/admin/departments error:", error);
        return NextResponse.json({ error: "Failed to create department" }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== "ADMIN") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");
        if (!id) {
            return NextResponse.json({ error: "Department ID required" }, { status: 400 });
        }

        await prisma.department.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("DELETE /api/admin/departments error:", error);
        return NextResponse.json({ error: "Failed to delete department" }, { status: 500 });
    }
}
