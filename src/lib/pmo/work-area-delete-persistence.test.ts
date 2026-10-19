import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

const databaseEnabled = Boolean(process.env.DATABASE_URL);

describe.runIf(databaseEnabled)("work-area delete constraints", () => {
  it("rejects direct deletion while a project references the area", async () => {
    const prisma = new PrismaClient();
    const suffix = randomUUID();
    const areaId = `delete-area-${suffix}`;
    const projectId = `delete-project-${suffix}`;

    try {
      await prisma.workArea.create({
        data: { id: areaId, name: areaId, normalizedName: areaId },
      });
      await prisma.project.create({
        data: { id: projectId, name: projectId, workAreaId: areaId },
      });

      await expect(
        prisma.workArea.delete({ where: { id: areaId } }),
      ).rejects.toMatchObject({ code: "P2003" });
    } finally {
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.workArea.deleteMany({ where: { id: areaId } });
      await prisma.$disconnect();
    }
  });

  it("rejects direct deletion while a case study references the area", async () => {
    const prisma = new PrismaClient();
    const suffix = randomUUID();
    const areaId = `delete-area-${suffix}`;
    const caseStudyId = `delete-case-${suffix}`;

    try {
      await prisma.workArea.create({
        data: { id: areaId, name: areaId, normalizedName: areaId },
      });
      await prisma.caseStudy.create({
        data: {
          id: caseStudyId,
          name: caseStudyId,
          workAreaId: areaId,
        },
      });

      await expect(
        prisma.workArea.delete({ where: { id: areaId } }),
      ).rejects.toMatchObject({ code: "P2003" });
    } finally {
      await prisma.caseStudy.deleteMany({ where: { id: caseStudyId } });
      await prisma.workArea.deleteMany({ where: { id: areaId } });
      await prisma.$disconnect();
    }
  });
});
