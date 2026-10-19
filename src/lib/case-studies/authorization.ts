import type { PrismaClient } from "@prisma/client";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import { prisma } from "@/lib/prisma";

type Db = Pick<PrismaClient, "caseStudy" | "caseStudyMember">;

export function canCreateCaseStudies(actor: SabahActor): boolean { return actor.role !== "VIEWER"; }

export async function canUpdateCaseStudy(id: string, actor: SabahActor, db: Db = prisma): Promise<boolean> {
  if (actor.role === "ADMIN") return true;
  const row = await db.caseStudy.findUnique({ where: { id }, select: { ownerId: true, members: { select: { userId: true } } } });
  return !!row && (row.ownerId === actor.id || row.members.some((m) => m.userId === actor.id));
}

export function visibleCaseStudyWhere(actor: SabahActor): Record<string, unknown> {
  const activeWorkArea = { OR: [{ workAreaId: null }, { workArea: { isArchived: false } }] };
  if (actor.role === "ADMIN") return activeWorkArea;
  return { AND: [activeWorkArea, { OR: [{ ownerId: actor.id }, { ownerId: null }, { members: { some: { userId: actor.id } } }, { departments: { some: { departmentId: { in: actor.departmentIds } } } }] }] };
}
