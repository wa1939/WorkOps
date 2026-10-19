import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { externalContactPatchSchema, normalizeContactEmail } from "@/lib/pmo/contacts";
import { writePmoAudit } from "@/lib/pmo/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isActive: true, role: true } });
    if (!actor?.isActive) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (actor.role === "VIEWER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    try {
        const { id } = await params;
        const input = externalContactPatchSchema.parse(await request.json());
        const contact = await prisma.$transaction(async (tx) => {
            const updated = await tx.externalContact.update({ where: { id }, data: { ...input, normalizedEmail: input.email ? normalizeContactEmail(input.email) : undefined } });
            await writePmoAudit(tx, { entityType: "external_contact", entityId: id, action: input.isArchived === true ? "archive" : input.isArchived === false ? "reactivate" : "update", actorId: session.user.id, changes: { fields: Object.keys(input) } });
            return updated;
        });
        return NextResponse.json(contact);
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "CONTACT_EXISTS" }, { status: 409 });
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return NextResponse.json({ error: "Contact not found" }, { status: 404 });
        if (error instanceof Error && error.name === "ZodError") return NextResponse.json({ error: "Invalid contact" }, { status: 400 });
        throw error;
    }
}
