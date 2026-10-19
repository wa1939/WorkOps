import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeContactEmail, externalContactInputSchema } from "@/lib/pmo/contacts";
import { writePmoAudit } from "@/lib/pmo/audit";

export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isActive: true, role: true } });
    if (!actor?.isActive) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const search = params.get("search")?.trim();
    const includeArchived = params.get("includeArchived") === "true";
    if (includeArchived && actor.role !== "ADMIN" && actor.role !== "MANAGER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json(await prisma.externalContact.findMany({
        where: {
            ...(includeArchived ? {} : { isArchived: false }),
            ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { email: { contains: search, mode: "insensitive" as const } }, { organization: { contains: search, mode: "insensitive" as const } }] } : {}),
        },
        orderBy: [{ isArchived: "asc" }, { name: "asc" }],
    }));
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isActive: true, role: true } });
    if (!actor?.isActive) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (actor.role === "VIEWER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    try {
        const input = externalContactInputSchema.parse(await request.json());
        const normalizedEmail = normalizeContactEmail(input.email);
        const existing = await prisma.externalContact.findUnique({ where: { normalizedEmail } });
        if (existing) return NextResponse.json({ error: "CONTACT_EXISTS", contact: existing }, { status: 409 });
        const contact = await prisma.$transaction(async (tx) => {
            const created = await tx.externalContact.create({ data: { ...input, email: input.email.trim(), normalizedEmail, createdById: session.user.id } });
            await writePmoAudit(tx, { entityType: "external_contact", entityId: created.id, action: "create", actorId: session.user.id, changes: { fields: ["name", "email", "department", "organization"] } });
            return created;
        });
        return NextResponse.json(contact, { status: 201 });
    } catch (error) {
        if (error instanceof Error && error.name === "ZodError") return NextResponse.json({ error: "Invalid contact" }, { status: 400 });
        throw error;
    }
}
