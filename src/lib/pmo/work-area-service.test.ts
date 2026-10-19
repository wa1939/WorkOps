import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PmoForbiddenError } from "./authorization";
import {
  deleteEmptyWorkArea,
  PmoWorkAreaInUseError,
  PmoWorkAreaNotFoundError,
} from "./work-area-service";

const manager = { id: "manager", role: "MANAGER" as const };

function fakeDatabase(area: unknown) {
  const tx = {
    workArea: {
      findUnique: vi.fn().mockResolvedValue(area),
      delete: vi.fn().mockResolvedValue({ id: "area-1", name: "People" }),
    },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    db: {
      workArea: {
        findUnique: vi.fn().mockResolvedValue(area),
      },
      $transaction: vi.fn(async (callback: (client: never) => unknown) =>
        callback(tx as never),
      ),
    },
  };
}

describe("deleteEmptyWorkArea", () => {
  it("deletes an empty area and records a metadata-safe audit event", async () => {
    const { db, tx } = fakeDatabase({
      id: "area-1",
      name: "People",
      _count: { projects: 0, caseStudies: 0 },
    });

    await expect(
      deleteEmptyWorkArea("area-1", manager, db as never),
    ).resolves.toEqual({ id: "area-1", name: "People" });

    expect(tx.workArea.delete).toHaveBeenCalledWith({
      where: { id: "area-1" },
      select: { id: true, name: true },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "work_area",
        entityId: "area-1",
        action: "delete",
        actorId: "manager",
        metaJson: JSON.stringify({
          fields: ["name"],
          areaName: "People",
          projectCount: 0,
          caseStudyCount: 0,
          success: true,
        }),
      }),
    });
  });

  it("rejects an area referenced by projects or case studies", async () => {
    const { db, tx } = fakeDatabase({
      id: "area-1",
      name: "People",
      _count: { projects: 2, caseStudies: 1 },
    });

    await expect(
      deleteEmptyWorkArea("area-1", manager, db as never),
    ).rejects.toEqual(new PmoWorkAreaInUseError(2, 1));
    expect(tx.workArea.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects an inactive reference that wins a delete race", async () => {
    const { db, tx } = fakeDatabase({
      id: "area-1",
      name: "People",
      _count: { projects: 0, caseStudies: 0 },
    });
    tx.workArea.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Foreign key violation", {
        code: "P2003",
        clientVersion: "5.22.0",
      }),
    );

    await expect(
      deleteEmptyWorkArea("area-1", manager, db as never),
    ).rejects.toBeInstanceOf(PmoWorkAreaInUseError);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects a missing area", async () => {
    const { db, tx } = fakeDatabase(null);

    await expect(
      deleteEmptyWorkArea("missing", manager, db as never),
    ).rejects.toBeInstanceOf(PmoWorkAreaNotFoundError);
    expect(tx.workArea.delete).not.toHaveBeenCalled();
  });

  it("rejects members before opening a transaction", async () => {
    const { db } = fakeDatabase(null);

    await expect(
      deleteEmptyWorkArea(
        "area-1",
        { id: "member", role: "MEMBER" },
        db as never,
      ),
    ).rejects.toBeInstanceOf(PmoForbiddenError);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
