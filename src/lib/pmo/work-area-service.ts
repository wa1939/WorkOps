import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canManageWorkAreas,
  PmoForbiddenError,
  type PmoActor,
} from "./authorization";
import { writePmoAudit } from "./audit";

export class PmoWorkAreaNotFoundError extends Error {
  constructor() {
    super("Work area not found");
    this.name = "PmoWorkAreaNotFoundError";
  }
}

export class PmoWorkAreaInUseError extends Error {
  constructor(
    public readonly projectCount: number,
    public readonly caseStudyCount: number,
  ) {
    super("Work area is referenced and must be archived instead");
    this.name = "PmoWorkAreaInUseError";
  }
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === code
  );
}

async function currentReferenceCounts(db: PrismaClient, id: string) {
  return db.workArea.findUnique({
    where: { id },
    select: {
      _count: { select: { projects: true, caseStudies: true } },
    },
  });
}

export async function deleteEmptyWorkArea(
  id: string,
  actor: PmoActor,
  db: PrismaClient = prisma,
): Promise<{ id: string; name: string }> {
  if (!canManageWorkAreas(actor)) throw new PmoForbiddenError();

  try {
    return await db.$transaction(
      async (tx) => {
        const area = await tx.workArea.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            _count: { select: { projects: true, caseStudies: true } },
          },
        });
        if (!area) throw new PmoWorkAreaNotFoundError();

        const { projects: projectCount, caseStudies: caseStudyCount } =
          area._count;
        if (projectCount > 0 || caseStudyCount > 0) {
          throw new PmoWorkAreaInUseError(projectCount, caseStudyCount);
        }

        const deleted = await tx.workArea.delete({
          where: { id },
          select: { id: true, name: true },
        });
        await writePmoAudit(tx, {
          entityType: "work_area",
          entityId: id,
          action: "delete",
          actorId: actor.id,
          changes: {
            fields: ["name"],
            areaName: area.name,
            projectCount: 0,
            caseStudyCount: 0,
            success: true,
          },
        });
        return deleted;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (isPrismaError(error, "P2003")) {
      const counts = await currentReferenceCounts(db, id);
      throw new PmoWorkAreaInUseError(
        counts?._count.projects ?? 0,
        counts?._count.caseStudies ?? 0,
      );
    }
    if (isPrismaError(error, "P2025")) {
      throw new PmoWorkAreaNotFoundError();
    }
    throw error;
  }
}
