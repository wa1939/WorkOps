import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getSavedViewForActor, updateSavedView, SavedViewCommandError } from "@/lib/saved-views/commands";
import { z } from "zod";
import { blocksJsonSchema } from "@/lib/saved-views/schemas";

const updateViewSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    icon: z.string().optional().nullable(),
    color: z.string().optional(),
    blocksJson: blocksJsonSchema.optional(),
    scope: z.enum(["PERSONAL", "TEAM"]).optional(),
    expectedUpdatedAt: z.string().datetime(),
}).strict();

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const view = await getSavedViewForActor((await params).id, {
            id: session.user.id, role: session.user.role as any, departmentIds: (session.user as any).departmentIds ?? [],
        });
        return NextResponse.json(view);
    } catch (error) {
        if (error instanceof SavedViewCommandError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        console.error("GET /api/saved-views/[id] error:", error);
        return NextResponse.json({ error: "Failed to fetch view" }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const { id } = await params;
        const body = await request.json();
        const { expectedUpdatedAt: suppliedExpectedUpdatedAt, ...legacyBody } = body;
        const parsed = updateViewSchema.omit({ expectedUpdatedAt: true }).parse(legacyBody);
        let expectedUpdatedAt = suppliedExpectedUpdatedAt;
        if (expectedUpdatedAt === undefined) {
            // Legacy editor payloads omit the version; adapt them to the stale-safe command.
            const current = await prisma.savedView.findUnique({ where: { id }, select: { updatedAt: true } });
            if (!current) return NextResponse.json({ error: "View not found" }, { status: 404 });
            expectedUpdatedAt = current.updatedAt.toISOString();
        }
        const view = await updateSavedView(id, { ...parsed, expectedUpdatedAt }, {
            id: session.user.id, role: session.user.role as any, departmentIds: (session.user as any).departmentIds ?? [],
        });
        return NextResponse.json(view);
    } catch (error: any) {
        if (error?.code === "VERSION_CONFLICT") {
            return NextResponse.json({ error: error.message, code: "VERSION_CONFLICT" }, { status: 409 });
        }
        if (error instanceof SavedViewCommandError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }
        if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors }, { status: 400 });
        console.error("PATCH /api/saved-views/[id] error:", error);
        return NextResponse.json({ error: "Failed to update view" }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;

        // Check ownership
        const existing = await prisma.savedView.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json({ error: "View not found" }, { status: 404 });
        }
        if (existing.ownerId !== session.user.id) {
            return NextResponse.json({ error: "Not authorized to delete" }, { status: 403 });
        }

        await prisma.savedView.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("DELETE /api/saved-views/[id] error:", error);
        return NextResponse.json({ error: "Failed to delete view" }, { status: 500 });
    }
}
