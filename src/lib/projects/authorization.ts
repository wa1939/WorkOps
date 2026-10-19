import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SabahActor } from "@/lib/sabah/auth/actor";

type ProjectDatabase = Pick<PrismaClient, "project" | "projectMember">;

/** Roles allowed to create projects — VIEWER is read-only by spec. */
export function canCreateProjects(actor: SabahActor): boolean {
    return actor.role !== "VIEWER";
}

/** Update permission mirrors existing route semantics: owner, manager, member, or ADMIN. */
export async function canUpdateProject(
    projectId: string,
    actor: SabahActor,
    db: ProjectDatabase = prisma,
): Promise<boolean> {
    const project = await db.project.findUnique({
        where: { id: projectId },
        select: { ownerId: true, managerId: true },
    });
    if (!project) {
        return false;
    }
    if (actor.role === "ADMIN") {
        return true;
    }
    if (project.ownerId === actor.id || project.managerId === actor.id) {
        return true;
    }
    const membership = await db.projectMember.findFirst({
        where: { projectId, userId: actor.id },
        select: { id: true },
    });
    return membership != null;
}
