import { describe, expect, it, vi } from "vitest";
import { addTaskDependencies } from "./commands";

describe("task dependency validation", () => {
  it("rejects a dependency cycle before writing", async () => {
    const db = {
      $transaction: vi.fn(async (fn: (tx: any) => unknown) => fn(db)),
      task: { findFirst: vi.fn().mockResolvedValue({ id: "a", createdById: "u1", assignments: [] }), findMany: vi.fn().mockResolvedValue([{ id: "a" }, { id: "c" }]) },
      taskDependency: { findMany: vi.fn().mockResolvedValue([{ taskId: "c", dependsOnId: "a" }]), createMany: vi.fn() },
      auditLog: { create: vi.fn() },
    } as any;
    await expect(addTaskDependencies("a", ["c"], { id: "u1", role: "MEMBER" }, db)).rejects.toThrow(/cycle/i);
    expect(db.taskDependency.createMany).not.toHaveBeenCalled();
  });

  it("rejects an existing edge before writing", async () => {
    const db = {
      $transaction: vi.fn(async (fn: (tx: any) => unknown) => fn(db)),
      task: { findFirst: vi.fn().mockResolvedValue({ id: "a", createdById: "u1", assignments: [] }), findMany: vi.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]) },
      taskDependency: { findMany: vi.fn().mockResolvedValue([{ taskId: "a", dependsOnId: "b" }]), createMany: vi.fn() },
      auditLog: { create: vi.fn() },
    } as any;
    await expect(addTaskDependencies("a", ["b"], { id: "u1", role: "MEMBER" }, db)).rejects.toThrow(/already exists/i);
    expect(db.taskDependency.createMany).not.toHaveBeenCalled();
  });
});
