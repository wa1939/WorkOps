import { describe, expect, it, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  leaveRequest: { findMany: vi.fn() },
  task: { findFirst: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tasks/commands", () => ({ reassignTask: vi.fn() }));

import { reassignTask } from "@/lib/tasks/commands";
import { allocateTaskEffort } from "@/lib/workload/allocation";
import {
  TEAM_CAPABILITIES,
  teamMembersCapability,
  teamCapacityCapability,
  teamAssignmentCandidatesCapability,
  teamProposeRebalanceCapability,
} from "./team";

const actor = { id: "lead", role: "LEAD" as const, departmentIds: ["dept-1"] };
const viewer = { id: "viewer", role: "VIEWER" as const, departmentIds: ["dept-1"] };
const context = (a: typeof actor | typeof viewer = actor, extras: Record<string, unknown> = {}) => ({ actor: a, requestId: "r", conversationId: null, workflowId: null, now: new Date("2026-08-23T00:00:00Z"), ...extras });

const workload = (inputVersion = "load-v1", computedAt = "2026-08-23T00:30:00.000Z") => ({
  inputVersion,
  calendarVersion: "calendar-v1",
  computedAt,
  rows: [
    { userId: "u1", weekStart: new Date("2026-08-23T00:00:00.000Z"), loadHours: 12, loadPercent: 34, driversJson: JSON.stringify({ capacity: 35 }) },
    { userId: "u2", weekStart: new Date("2026-08-23T00:00:00.000Z"), loadHours: 4, loadPercent: 11, driversJson: JSON.stringify({ capacity: 35 }) },
  ],
});

const rebalanceTask = {
  id: "t",
  title: "Task",
  dueAt: new Date("2026-08-24T09:00:00Z"),
  effortHours: 10,
  aiEffortHours: null,
  actualHours: null,
  updatedAt: new Date("2026-08-23T00:00:00Z"),
  status: "TODO",
  isPrivate: false,
  assignments: [{ userId: "u1", plannedShare: null }],
};

beforeEach(() => vi.clearAllMocks());

describe("team capabilities", () => {
  it("exposes exactly the four read/proposal names and no performance surface", () => {
    expect(TEAM_CAPABILITIES.map((capability) => capability.name)).toEqual([
      "team.members", "team.capacity", "team.assignmentCandidates", "team.proposeRebalance",
    ]);
    expect(JSON.stringify(TEAM_CAPABILITIES)).not.toMatch(/performance|productivity|completionRate|score/i);
  });

  it("returns active members with viewer-safe fields and deterministic ordering", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: "u2", name: "Zed", title: null, role: "MEMBER", managerId: null },
      { id: "u1", name: "Amy", title: "Analyst", role: "MEMBER", managerId: "lead", email: "secret", image: "secret" },
    ]);
    const result = await teamMembersCapability.execute({}, context(viewer));
    expect(result).toEqual([
      { id: "u1", displayName: "Amy", title: "Analyst", role: "MEMBER", managerId: "lead" },
      { id: "u2", displayName: "Zed", title: null, role: "MEMBER", managerId: null },
    ]);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true }, select: expect.not.objectContaining({ email: true, image: true }) }));
  });

  it("rejects proposal writes for viewers and requires explicit approval", async () => {
    expect(teamProposeRebalanceCapability.requiresExplicitApproval).toBe(true);
    await expect(teamProposeRebalanceCapability.available(viewer)).resolves.toBe(false);
    await expect(teamProposeRebalanceCapability.authorize({ taskId: "t", targetUserId: "u" }, context(viewer))).rejects.toMatchObject({ status: 403 });
  });

  it("excludes private tasks and accounts for approved Sun-Thu leave in capacity", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "u1", name: "Amy", title: null, role: "MEMBER", managerId: null, capacityPerWeekHours: 35 }]);
    prismaMock.task.findMany.mockResolvedValue([
      { id: "public", title: "Public", dueAt: new Date("2026-08-24T09:00:00Z"), effortHours: 10, aiEffortHours: null, isPrivate: false, status: "TODO", assignments: [{ userId: "u1" }] },
      { id: "private", title: "Private", dueAt: new Date("2026-08-24T09:00:00Z"), effortHours: 99, aiEffortHours: null, isPrivate: true, status: "TODO", assignments: [{ userId: "u1" }] },
    ]);
    prismaMock.leaveRequest.findMany.mockResolvedValue([{ userId: "u1", startAt: new Date("2026-08-23T00:00:00Z"), endAt: new Date("2026-08-27T23:59:00Z"), status: "Approved" }]);
    const rows = await teamCapacityCapability.execute({ weeks: 1 }, context(viewer));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "u1", loadHours: 10, capacityHours: 0, leaveDays: 5, isOnLeave: true, loadPercent: 200 });
    expect(rows[0].drivers).toEqual([{ taskId: "public", title: "Public", hours: 10, source: "manual" }]);
  });

  it("counts overdue and undated tasks only in the current window, and future tasks only in their week", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "u1", name: "Amy", title: null, role: "MEMBER", managerId: null, capacityPerWeekHours: 35 }]);
    prismaMock.task.findMany.mockResolvedValue([
      { id: "overdue", title: "Overdue", dueAt: new Date("2026-08-22T09:00:00Z"), effortHours: 1, aiEffortHours: null, isPrivate: false, status: "TODO", assignments: [{ userId: "u1" }] },
      { id: "undated", title: "Undated", dueAt: null, effortHours: 2, aiEffortHours: null, isPrivate: false, status: "TODO", assignments: [{ userId: "u1" }] },
      { id: "current", title: "Current", dueAt: new Date("2026-08-24T09:00:00Z"), effortHours: 3, aiEffortHours: null, isPrivate: false, status: "TODO", assignments: [{ userId: "u1" }] },
      { id: "future", title: "Future", dueAt: new Date("2026-08-31T09:00:00Z"), effortHours: 4, aiEffortHours: null, isPrivate: false, status: "TODO", assignments: [{ userId: "u1" }] },
    ]);
    prismaMock.leaveRequest.findMany.mockResolvedValue([]);

    const rows = await teamCapacityCapability.execute({ weeks: 2 }, context(viewer));

    expect(rows.map((row) => ({ weekStart: row.weekStart, loadHours: row.loadHours, sourceIds: row.sourceIds }))).toEqual([
      { weekStart: "2026-08-23T00:00:00.000Z", loadHours: 6, sourceIds: ["current", "undated", "overdue"] },
      { weekStart: "2026-08-30T00:00:00.000Z", loadHours: 4, sourceIds: ["future"] },
    ]);
  });

  it("orders candidates by projected slack and adds proposed effort without hidden scoring", async () => {
    prismaMock.task.findFirst.mockResolvedValue({ id: "t", title: "Task", dueAt: new Date("2026-08-24T09:00:00Z"), effortHours: 5, aiEffortHours: null, isPrivate: false, status: "TODO", assignments: [{ userId: "u1" }] });
    prismaMock.user.findMany.mockResolvedValue([
      { id: "u2", name: "Bob", title: null, role: "MEMBER", managerId: null, capacityPerWeekHours: 35 },
      { id: "u1", name: "Amy", title: null, role: "MEMBER", managerId: null, capacityPerWeekHours: 35 },
    ]);
    prismaMock.task.findMany.mockResolvedValue([]);
    prismaMock.leaveRequest.findMany.mockResolvedValue([]);
    const rows = await teamAssignmentCandidatesCapability.execute({ taskId: "t" }, context());
    expect(rows.map((row) => row.userId)).toEqual(["u1", "u2"]);
    expect(rows[0]).toMatchObject({ projectedLoadHours: 5, projectedLoadPercent: 14, leaveDays: 0, isOnLeave: false, role: "MEMBER", workAreaIds: [], sourceIds: ["t"] });
    expect(Object.keys(rows[0])).not.toContain("score");
  });

  it("grounds rebalance preview in workload service and allocation math", async () => {
    prismaMock.task.findFirst.mockResolvedValue(rebalanceTask);
    prismaMock.user.findMany.mockResolvedValue([
      { id: "u1", name: "Amy", title: null, role: "MEMBER", managerId: null, capacityPerWeekHours: 35 },
      { id: "u2", name: "Bob", title: null, role: "MEMBER", managerId: null, capacityPerWeekHours: 35 },
    ]);
    const workloadReader = vi.fn().mockResolvedValue(workload());
    const proposal = await teamProposeRebalanceCapability.execute(
      { taskId: "t", targetUserId: "u2" },
      context(actor, { workloadReader }),
    );

    const proposedTaskAllocation = allocateTaskEffort(
      { remainingEffortHours: 10, status: "TODO" },
      [{ userId: "u2", plannedShare: 1 }],
    ).allocations;
    const byUser = new Map(proposal.allocations.map((row) => [row.userId, row]));
    expect(byUser.get("u1")).toMatchObject({ currentAllocatedHours: 12, proposedAllocatedHours: 2, delta: -10 });
    expect(byUser.get("u2")).toMatchObject({ currentAllocatedHours: 4, proposedAllocatedHours: 14, delta: 10 });
    expect(byUser.get("u2")?.proposedAllocatedHours).toBeCloseTo(4 + proposedTaskAllocation[0].hours, 10);
    expect(proposal.inputVersion).toBe("load-v1");
    expect(proposal.computedAt).toBe("2026-08-23T00:30:00.000Z");

    const preview = await teamProposeRebalanceCapability.preview(
      { taskId: "t", targetUserId: "u2" },
      context(actor, { workloadReader: vi.fn().mockResolvedValue(workload()) }),
    );
    expect(preview.fields.find((field) => field.path === "allocations")?.proposed).toEqual(proposal.allocations);
    expect(workloadReader).toHaveBeenCalled();
  });

  it("rejects approval when the allocation version changed, then accepts the current version", async () => {
    prismaMock.task.findFirst.mockResolvedValue(rebalanceTask);
    prismaMock.user.findMany.mockResolvedValue([
      { id: "u1", name: "Amy", title: null, role: "MEMBER", managerId: null, capacityPerWeekHours: 35 },
      { id: "u2", name: "Bob", title: null, role: "MEMBER", managerId: null, capacityPerWeekHours: 35 },
    ]);
    vi.mocked(reassignTask).mockResolvedValue(rebalanceTask as never);
    const workloadReader = vi.fn()
      .mockResolvedValueOnce(workload("load-v2", "2026-08-23T00:40:00.000Z"))
      .mockResolvedValueOnce(workload("load-v1"));

    await expect(teamProposeRebalanceCapability.execute(
      { taskId: "t", targetUserId: "u2", inputVersion: "load-v1", computedAt: "2026-08-23T00:30:00.000Z" },
      context(actor, { workloadReader }),
    )).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect(reassignTask).not.toHaveBeenCalled();

    await expect(teamProposeRebalanceCapability.execute(
      { taskId: "t", targetUserId: "u2", inputVersion: "load-v1", computedAt: "2026-08-23T00:30:00.000Z" },
      context(actor, { workloadReader }),
    )).resolves.toMatchObject({ accepted: true, proposed: true });
    expect(reassignTask).toHaveBeenCalledWith("t", ["u2"], actor);
  });

  it("rejects deadline effects during acceptance while allowing assignee-only changes", async () => {
    prismaMock.task.findFirst.mockResolvedValue(rebalanceTask);
    prismaMock.user.findMany.mockResolvedValue([
      { id: "u1", name: "Amy", title: null, role: "MEMBER", departmentIds: [], capacityPerWeekHours: 35 },
      { id: "u2", name: "Bob", title: null, role: "MEMBER", departmentIds: [], capacityPerWeekHours: 35 },
    ]);
    vi.mocked(reassignTask).mockResolvedValue(rebalanceTask as never);
    const workloadReader = vi.fn().mockResolvedValue(workload());

    await expect(teamProposeRebalanceCapability.execute(
      { taskId: "t", targetUserId: "u2", dueDate: "2026-09-01T09:00:00.000Z", inputVersion: "load-v1", computedAt: "2026-08-23T00:30:00.000Z" },
      context(actor, { workloadReader }),
    )).rejects.toMatchObject({ status: 409, code: "DEADLINE_CHANGE_REQUIRES_SEPARATE_APPROVAL" });
    expect(reassignTask).not.toHaveBeenCalled();

    await teamProposeRebalanceCapability.execute(
      { taskId: "t", targetUserId: "u2", inputVersion: "load-v1", computedAt: "2026-08-23T00:30:00.000Z" },
      context(actor, { workloadReader }),
    );
    expect(reassignTask).toHaveBeenCalledWith("t", ["u2"], actor);
  });
  it("returns a reviewed tasks.reassign step and never executes it directly", async () => {
    prismaMock.task.findFirst.mockResolvedValue({ id: "t", title: "Task", dueAt: new Date("2026-08-24T09:00:00Z"), updatedAt: new Date("2026-08-23T00:00:00Z"), effortHours: 5, aiEffortHours: null, actualHours: null, isPrivate: false, status: "TODO", assignments: [{ userId: "u1", plannedShare: null }] });
    prismaMock.user.findMany.mockResolvedValue([{ id: "u2", name: "Bob", title: null, role: "MEMBER", managerId: null, capacityPerWeekHours: 35 }]);
    const proposal = await teamProposeRebalanceCapability.execute({ taskId: "t", targetUserId: "u2" }, context(actor, { workloadReader: vi.fn().mockResolvedValue(workload()) }));
    expect(proposal.proposed).toBe(true);
    expect(proposal.steps).toEqual([{ capability: "tasks.reassign", index: 0, input: { id: "t", assigneeIds: ["u2"] }, reason: expect.any(String), confidence: expect.any(String) }]);
    expect(reassignTask).not.toHaveBeenCalled();
  });
});
