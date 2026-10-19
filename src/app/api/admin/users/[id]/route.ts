import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";

const userUpdateSchema = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    role: z.enum(["ADMIN", "MANAGER", "MEMBER", "VIEWER"]).optional(),
    isActive: z.boolean().optional(),
    capacityPerWeekHours: z.number().min(0).max(168).optional(),
    managerId: z.string().nullable().optional(),
});

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== "ADMIN") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { id } = await params;
        const body = await request.json();
        const data = userUpdateSchema.parse(body);

        const user = await prisma.user.update({
            where: { id },
            data,
            select: { id: true, name: true, email: true, role: true, isActive: true, capacityPerWeekHours: true },
        });

        return NextResponse.json(user);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
        }
        console.error("PATCH /api/admin/users/[id] error:", error);
        return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== "ADMIN") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { id } = await params;

        if (id === session.user.id) {
            return NextResponse.json(
                { error: "Cannot delete yourself" },
                { status: 400 },
            );
        }

        const target = await prisma.user.findUnique({
            where: { id },
            select: { id: true, email: true, name: true, role: true },
        });

        if (!target) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        if (target.role === "ADMIN") {
            const activeAdmins = await prisma.user.count({
                where: { role: "ADMIN", isActive: true },
            });
            if (activeAdmins <= 1) {
                return NextResponse.json(
                    { error: "Cannot delete the last active admin" },
                    { status: 400 },
                );
            }
        }

        // PMO ownership uses required RESTRICT foreign keys, so deleting a user who
        // still owns PMO records would fail the whole transaction (P2003) as a 500.
        // Block with an actionable 409 and tell the admin to reassign first.
        const [externalActions, followUpEvents, evidence, contacts] = await Promise.all([
            prisma.externalAction.count({ where: { ownerId: id } }),
            prisma.followUpEvent.count({ where: { ownerId: id } }),
            prisma.actionEvidence.count({ where: { addedById: id } }),
            prisma.externalContact.count({ where: { createdById: id } }),
        ]);
        if (externalActions || followUpEvents || evidence || contacts) {
            return NextResponse.json(
                {
                    error: "Reassign this user's PMO actions, follow-ups, evidence, and contacts before deleting.",
                    pmo: { externalActions, followUpEvents, evidence, contacts },
                },
                { status: 409 },
            );
        }

        await prisma.$transaction([
            prisma.project.updateMany({ where: { ownerId: id }, data: { ownerId: null } }),
            prisma.caseStudy.updateMany({ where: { ownerId: id }, data: { ownerId: null } }),
            prisma.kPI.updateMany({ where: { ownerId: id }, data: { ownerId: null } }),
            prisma.task.updateMany({ where: { createdById: id }, data: { createdById: null } }),
            prisma.auditLog.updateMany({ where: { actorId: id }, data: { actorId: null } }),
            prisma.user.delete({ where: { id } }),
        ]);

        await prisma.auditLog.create({
            data: {
                entityType: "user",
                entityId: id,
                action: "delete",
                actorId: session.user.id,
                metaJson: JSON.stringify({
                    deletedUser: { email: target.email, name: target.name, role: target.role },
                }),
            },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("DELETE /api/admin/users/[id] error:", error);
        return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
    }
}
