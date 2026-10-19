import { describe, expect, it, vi } from "vitest";
import { classifyOverlap, findDuplicateCandidates, type DuplicateDb, type DuplicateRecord } from "./duplicates";

const actor = { id: "user-1", role: "MEMBER" as const, departmentIds: ["dept-1"] };

function dbFor(rows: DuplicateRecord[]) {
  const byType = (type: "PROJECT" | "TASK") => {
    const values = rows.filter((row) => (type === "PROJECT" ? row.name !== undefined : row.title !== undefined));
    return {
      findMany: vi.fn(async (args: { where?: { id?: { in?: string[]; gt?: string } } }) => {
        const ids = args.where?.id?.in;
        return ids ? values.filter((row) => ids.includes(row.id)) : values;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => values.find((row) => row.id === where.id) ?? null),
    };
  };
  return { scopeDb: { project: byType("PROJECT"), task: byType("TASK") } as DuplicateDb["scopeDb"], loadCandidates: vi.fn(async (type: "PROJECT" | "TASK", ids: string[]) => byType(type).findMany({ where: { id: { in: ids } } })) };
}

describe("duplicate and related-work detection", () => {
  it("blocks a retry identified only by the workflow idempotency key", async () => {
    const db = { ...dbFor([]), findExistingIdempotentWorkflow: vi.fn(async (key: string, actorId: string) => key === "retry-only" && actorId === actor.id ? { id: "workflow-1", updatedAt: new Date("2026-08-10") } : null) };
    const result = await findDuplicateCandidates({ entityType: "TASK", title: "A new task", idempotencyKey: "retry-only" }, actor, db);
    expect(result[0]?.overlap).toBe("EXACT");
    expect(result[0]?.reasons.join(" ")).toMatch(/idempotency/i);
  });

  it("uses typed plural provenance and never promotes cross-type evidence", async () => {
    const result = await findDuplicateCandidates({ entityType: "TASK", title: "Prepare report", description: "April" }, actor, dbFor([
      { id: "project-1", name: "Prepare report", description: "April", isPrivate: false, updatedAt: new Date("2026-08-10") },
      { id: "task-1", title: "Prepare report", description: "April", isPrivate: false, updatedAt: new Date("2026-08-11") },
    ]));
    const task = result.find((item) => item.source.entityType === "TASK");
    expect(result.every((item) => item.source.entityType === "TASK")).toBe(true);
    expect(task?.source.href).toBe("/tasks/task-1");
    expect(task?.duplicateOf.entityType).toBe("TASK");
    expect(task?.duplicateOf.href).toMatch(/^\/sabah\/preview\?entityType=TASK&checksum=/);
    expect(task?.source.sourceUpdatedAt).toBe("2026-08-11T00:00:00.000Z");
  });

  it("orders equally scored candidates by freshness before typed id", async () => {
    const result = await findDuplicateCandidates({ entityType: "TASK", title: "Prepare report", description: "April" }, actor, dbFor([
      { id: "task-old", title: "Prepare report", description: "April", isPrivate: false, updatedAt: new Date("2026-08-01") },
      { id: "task-new", title: "Prepare report", description: "April", isPrivate: false, updatedAt: new Date("2026-08-20") },
    ]));
    expect(result.map((item) => item.source.entityId)).toEqual(["task-new", "task-old"]);
  });
  it("blocks an exact retry and authorizes before retrieving candidate details", async () => {
    const rows = [{ id: "task-1", title: "Prepare monthly report", description: "April", createdById: actor.id, isPrivate: false, updatedAt: new Date("2026-08-10"), projectId: "project-1", signatureHash: "same" }];
    const db = dbFor(rows);
    const result = await findDuplicateCandidates({ entityType: "TASK", title: "Prepare monthly report", description: "April", idempotencyKey: "retry-1", fingerprint: "same" }, actor, db);
    expect(result[0]).toMatchObject({ source: { entityType: "TASK", entityId: "task-1" }, overlap: "EXACT", score: 1 });
    expect(result[0].reasons.join(" ")).toMatch(/exact|retry|fingerprint/i);
    expect(db.loadCandidates).toHaveBeenCalledTimes(1);
  });

  it("finds normalized Arabic variants, recurring monthly work, KPI/date overlap, and parent relations", async () => {
    const rows = [
      { id: "arabic-1", title: "مُراجعة الأداء", description: "", createdById: actor.id, isPrivate: false, updatedAt: new Date("2026-08-10") },
      { id: "monthly-1", title: "Monthly KPI review", description: "recurs monthly", createdById: actor.id, isPrivate: false, updatedAt: new Date("2026-08-10"), kpiId: "kpi-1", startAt: new Date("2026-08-15"), dueAt: new Date("2026-08-20") },
      { id: "parent-1", title: "Prepare performance report", description: "", createdById: actor.id, isPrivate: false, updatedAt: new Date("2026-08-10") },
    ];
    const result = await findDuplicateCandidates({ entityType: "TASK", title: "مراجعة الأداء", description: "Monthly KPI review", recurrence: "MONTHLY", kpiId: "kpi-1", startAt: "2026-08-18T00:00:00.000Z", dueAt: "2026-08-22T00:00:00.000Z", dependencyIds: ["parent-1"] }, actor, dbFor(rows));
    expect(result.map((item) => item.source.entityId)).toEqual(expect.arrayContaining(["parent-1", "monthly-1", "arabic-1"]));
    expect(result.find((item) => item.source.entityId === "monthly-1")?.overlap).toBe("RECURRING");
    expect(result.find((item) => item.source.entityId === "parent-1")?.reasons.join(" ")).toMatch(/dependency|relation/i);
  });

  it("does not elevate weak vocabulary and omits inaccessible private records", async () => {
    const result = await findDuplicateCandidates({ entityType: "TASK", title: "Report planning", description: "", projectId: "project-a" }, actor, dbFor([
      { id: "private-1", title: "Report planning", description: "", isPrivate: true, updatedAt: new Date() },
      { id: "unrelated-1", title: "Report archive", description: "", isPrivate: false, updatedAt: new Date() },
    ]));
    expect(result.map((item) => item.source.entityId)).not.toContain("private-1");
    expect(result).toHaveLength(0);
  });

  it("classifies likely, related, recurring, and exact overlaps deterministically", () => {
    const draft = { title: "A", description: "B" };
    expect(classifyOverlap({ score: 1, exact: true, recurring: false }, draft)).toBe("EXACT");
    expect(classifyOverlap({ score: 0.8, exact: false, recurring: false }, draft)).toBe("LIKELY_DUPLICATE");
    expect(classifyOverlap({ score: 0.45, exact: false, recurring: false }, draft)).toBe("RELATED");
    expect(classifyOverlap({ score: 0.9, exact: false, recurring: true }, draft)).toBe("RECURRING");
    expect(classifyOverlap({ score: 0.999, exact: false, recurring: false }, draft)).toBe("LIKELY_DUPLICATE");
  });
});
