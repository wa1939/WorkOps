import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { privateTaskVisibility } from "@/lib/tasks/authorization";
import { defineCapability, type CapabilityContext } from "../contracts";
import type { CapabilityRegistry } from "../registry";
import type { SabahActor } from "@/lib/sabah/auth/actor";

const idSchema = z.string().min(1);
const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const estimateStateSchema = z.enum(["known", "unknown"]);
const poolInputSchema = z.object({ limit: z.number().int().min(1).max(20).default(10), workspaceId: idSchema.optional() });
const helpCandidatesInputSchema = z.object({ userId: idSchema, workspaceId: idSchema.optional() });
const prepareTaskInputSchema = z.object({ taskId: idSchema, workspaceId: idSchema.optional() });

const poolRowSchema = z.object({
  taskId: idSchema,
  title: z.string(),
  priority: prioritySchema,
  dueAt: z.string().datetime().nullable(),
  estimateState: estimateStateSchema,
  tags: z.array(z.string()),
  blockers: z.array(z.string()),
});
const helpCandidateSchema = z.object({
  taskId: idSchema,
  title: z.string(),
  ownerLoadPercent: z.number(),
  priority: prioritySchema,
});
const prepareTaskOutputSchema = z.object({
  brief: z.string(),
  checklist: z.array(z.string()),
  sourceLinks: z.array(z.string()),
});

const PRIORITY_RANK: Record<z.infer<typeof prioritySchema>, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  URGENT: 3,
};

type TaskDependencyRow = {
  id: string;
  title: string;
  status: string;
  isPrivate: boolean;
  createdById: string | null;
  assignments: Array<{ userId: string }>;
};

type ClaimableTaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: z.infer<typeof prioritySchema>;
  dueAt: Date | null;
  effortHours: number | null;
  aiEffortHours: number | null;
  isPrivate: boolean;
  createdById: string | null;
  assignments: Array<{ userId: string }>;
  tags: Array<{ tag: { name: string } }>;
  dependencies: Array<{ dependsOn: TaskDependencyRow }>;
};

type PreparationTaskRow = {
  id: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  links: Array<{ label: string; url: string }>;
  dependencies: Array<{ dependsOn: TaskDependencyRow }>;
  project: {
    name: string;
    links: Array<{ label: string; url: string }>;
  } | null;
};

export class WorkAssistanceError extends Error {
  constructor(message: string, public readonly status: number, public readonly code = "WORK_ASSISTANCE_ERROR") {
    super(message);
    this.name = "WorkAssistanceError";
  }
}

function notFound(): never {
  throw new WorkAssistanceError("Task not found", 404, "NOT_FOUND");
}

function workspaceIdFor(input: { workspaceId?: string }, context: CapabilityContext): string | undefined {
  return input.workspaceId ?? (context as CapabilityContext & { workspaceId?: string }).workspaceId;
}

function visibleTaskWhere(actor: SabahActor, workspaceId: string | undefined): Record<string, unknown> {
  return {
    AND: [
      privateTaskVisibility(actor),
      ...(workspaceId === undefined ? [] : [{ workspaceId }]),
    ],
  };
}

function isVisibleTask(task: Pick<ClaimableTaskRow, "isPrivate" | "createdById" | "assignments"> | TaskDependencyRow, actor: SabahActor): boolean {
  return actor.role === "ADMIN"
    || !task.isPrivate
    || task.createdById === actor.id
    || task.assignments.some((assignment) => assignment.userId === actor.id);
}

function blockersFor(task: ClaimableTaskRow, actor: SabahActor): string[] {
  const blockers: string[] = [];
  if (task.status === "BLOCKED") blockers.push("Task is marked BLOCKED");
  if (task.status === "WAITING") blockers.push("Task is marked WAITING");
  for (const dependency of task.dependencies) {
    const blockedBy = dependency.dependsOn;
    if (["DONE", "CANCELED"].includes(blockedBy.status)) continue;
    blockers.push(isVisibleTask(blockedBy, actor) ? blockedBy.title : "Unavailable dependency");
  }
  return Array.from(new Set(blockers));
}

function compareDueAt(left: Date | null, right: Date | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.getTime() - right.getTime();
}

type TaskSortRow = { priority: string; dueAt: Date | null; title: string; id?: string; taskId?: string };

function compareTasks(left: TaskSortRow, right: TaskSortRow): number {
  const priorityDifference = (PRIORITY_RANK[right.priority as z.infer<typeof prioritySchema>] ?? -1)
    - (PRIORITY_RANK[left.priority as z.infer<typeof prioritySchema>] ?? -1);
  if (priorityDifference !== 0) return priorityDifference;
  const dueDifference = compareDueAt(left.dueAt, right.dueAt);
  if (dueDifference !== 0) return dueDifference;
  return left.title.localeCompare(right.title, "en", { sensitivity: "base" })
    || (left.id ?? left.taskId ?? "").localeCompare(right.id ?? right.taskId ?? "");
}

function estimateState(task: Pick<ClaimableTaskRow, "effortHours" | "aiEffortHours">): z.infer<typeof estimateStateSchema> {
  return task.effortHours !== null || task.aiEffortHours !== null ? "known" : "unknown";
}

function toPoolRow(task: ClaimableTaskRow, actor: SabahActor) {
  return {
    taskId: task.id,
    title: task.title,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    estimateState: estimateState(task),
    tags: Array.from(new Set(task.tags.map((entry) => entry.tag.name))).sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" })),
    blockers: blockersFor(task, actor),
  };
}

async function findClaimableTasks(actor: SabahActor, workspaceId: string | undefined): Promise<ClaimableTaskRow[]> {
  return prisma.task.findMany({
    where: {
      AND: [
        privateTaskVisibility(actor),
        ...(workspaceId === undefined ? [] : [{ workspaceId }]),
        { status: { notIn: ["DONE", "CANCELED"] } },
        { assignments: { none: {} } },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      dueAt: true,
      effortHours: true,
      aiEffortHours: true,
      isPrivate: true,
      createdById: true,
      assignments: { select: { userId: true } },
      tags: { select: { tag: { select: { name: true } } } },
      dependencies: {
        select: {
          dependsOn: {
            select: {
              id: true,
              title: true,
              status: true,
              isPrivate: true,
              createdById: true,
              assignments: { select: { userId: true } },
            },
          },
        },
      },
    },
    orderBy: { title: "asc" },
  }) as unknown as ClaimableTaskRow[];
}

async function findVisiblePreparationTask(taskId: string, actor: SabahActor, workspaceId: string | undefined): Promise<PreparationTaskRow> {
  const task = await prisma.task.findFirst({
    where: {
      AND: [{ id: taskId }, visibleTaskWhere(actor, workspaceId)],
    },
    select: {
      id: true,
      title: true,
      description: true,
      dueAt: true,
      links: { select: { label: true, url: true } },
      dependencies: {
        select: {
          dependsOn: {
            select: {
              id: true,
              title: true,
              status: true,
              isPrivate: true,
              createdById: true,
              assignments: { select: { userId: true } },
            },
          },
        },
      },
      project: {
        select: {
          name: true,
          links: { select: { label: true, url: true } },
        },
      },
    },
  });
  if (!task) return notFound();
  return task as unknown as PreparationTaskRow;
}

function prepareOutput(task: PreparationTaskRow, actor: SabahActor) {
  const dependencies = task.dependencies
    .map((dependency) => dependency.dependsOn)
    .filter((dependency) => !["DONE", "CANCELED"].includes(dependency.status) && isVisibleTask(dependency, actor));
  const project = task.project;
  const description = task.description?.trim();
  const briefParts = [`Task: ${task.title}`];
  if (description) briefParts.push(`Description: ${description}`);
  if (project) briefParts.push(`Project: ${project.name}`);
  if (task.dueAt) briefParts.push(`Due: ${task.dueAt.toISOString()}`);
  if (dependencies.length) briefParts.push(`Dependencies: ${dependencies.map((dependency) => dependency.title).join(", ")}`);

  const checklist = [
    `Confirm the scope of “${task.title}”.`,
    ...(description ? ["Review the task description and acceptance details."] : []),
    ...(project ? [`Review the linked project “${project.name}”.`] : []),
    ...dependencies.map((dependency) => `Confirm dependency “${dependency.title}” is complete.`),
    ...(project?.links ?? []).map((link) => `Review source link: ${link.label || link.url}.`),
    ...task.links.map((link) => `Review source link: ${link.label || link.url}.`),
    "Complete the work and update the task status.",
  ];
  const sourceLinks = Array.from(new Set([
    ...task.links.map((link) => link.url),
    ...(project?.links ?? []).map((link) => link.url),
  ]));
  return { brief: briefParts.join("\n\n"), checklist, sourceLinks };
}

export const workPoolCapability = defineCapability({
  name: "work.pool",
  version: 1,
  module: "work-assistance",
  description: "List visible, unassigned, unblocked work that can be explicitly claimed.",
  risk: "READ",
  inputSchema: poolInputSchema,
  outputSchema: z.array(poolRowSchema),
  async available() { return true; },
  async authorize() {},
  async preview(input) {
    return { title: "Read the open work pool", fields: [{ path: "limit", proposed: input.limit }] };
  },
  async execute(input, context) {
    const tasks = await findClaimableTasks(context.actor, workspaceIdFor(input, context));
    return tasks
      .map((task) => ({ task, blockers: blockersFor(task, context.actor) }))
      .filter(({ blockers }) => blockers.length === 0)
      .sort((left, right) => compareTasks(left.task, right.task))
      .slice(0, input.limit ?? 10)
      .map(({ task }) => toPoolRow(task, context.actor));
  },
  async verify(output) { return output; },
  summarize(output) { return `Found ${output.length} claimable tasks.`; },
});

export const workHelpCandidatesCapability = defineCapability({
  name: "work.helpCandidates",
  version: 1,
  module: "work-assistance",
  description: "List visible claimable work from owners who are not on active leave.",
  risk: "READ",
  inputSchema: helpCandidatesInputSchema,
  outputSchema: z.array(helpCandidateSchema),
  async available() { return true; },
  async authorize() {},
  async preview(input) {
    return { title: "Find work the user could help with", fields: [{ path: "userId", proposed: input.userId }] };
  },
  async execute(input, context) {
    const workspaceId = workspaceIdFor(input, context);
    const tasks = (await findClaimableTasks(context.actor, workspaceId))
      .filter((task) => task.createdById !== null && task.createdById !== input.userId)
      .filter((task) => blockersFor(task, context.actor).length === 0);
    const ownerIds = Array.from(new Set(tasks.map((task) => task.createdById).filter((ownerId): ownerId is string => ownerId !== null)));
    if (!ownerIds.length) return [];

    const [leaveRows, snapshotRows] = await Promise.all([
      prisma.leaveRequest.findMany({
        where: {
          userId: { in: ownerIds },
          status: "Approved",
          startAt: { lte: context.now },
          endAt: { gte: context.now },
        },
        select: { userId: true },
      }),
      prisma.teamLoadSnapshot.findMany({
        where: { userId: { in: ownerIds }, weekStart: { lte: context.now } },
        select: { id: true, userId: true, loadPercent: true, weekStart: true, computedAt: true },
        orderBy: [{ weekStart: "desc" }, { computedAt: "desc" }, { id: "desc" }],
      }),
    ]);
    const onLeave = new Set(leaveRows.map((row) => row.userId));
    const loadByOwner = new Map<string, number>();
    for (const snapshot of snapshotRows) {
      if (!loadByOwner.has(snapshot.userId)) loadByOwner.set(snapshot.userId, snapshot.loadPercent);
    }

    return tasks
      .filter((task) => task.createdById !== null && !onLeave.has(task.createdById) && loadByOwner.has(task.createdById))
      .map((task) => ({
        taskId: task.id,
        title: task.title,
        ownerLoadPercent: loadByOwner.get(task.createdById as string) as number,
        priority: task.priority,
        dueAt: task.dueAt,
      }))
      .sort((left, right) => compareTasks(left, right))
      .map(({ taskId, title, ownerLoadPercent, priority }) => ({ taskId, title, ownerLoadPercent, priority }));
  },
  async verify(output) { return output; },
  summarize(output) { return `Found ${output.length} help candidates.`; },
});

export const workPrepareTaskCapability = defineCapability({
  name: "work.prepareTask",
  version: 1,
  module: "work-assistance",
  description: "Prepare a deterministic brief and checklist for a visible task without writing.",
  risk: "READ",
  inputSchema: prepareTaskInputSchema,
  outputSchema: prepareTaskOutputSchema,
  async available() { return true; },
  async authorize(input, context) {
    await findVisiblePreparationTask(input.taskId, context.actor, workspaceIdFor(input, context));
  },
  async preview(input, context) {
    const task = await findVisiblePreparationTask(input.taskId, context.actor, workspaceIdFor(input, context));
    return { title: `Prepare task “${task.title}”`, fields: [{ path: "taskId", proposed: input.taskId }] };
  },
  async execute(input, context) {
    const task = await findVisiblePreparationTask(input.taskId, context.actor, workspaceIdFor(input, context));
    return prepareOutput(task, context.actor);
  },
  async verify(output) { return output; },
  summarize() { return "Prepared a task brief and checklist without changing the task."; },
});

export const WORK_ASSISTANCE_CAPABILITIES = [workPoolCapability, workHelpCandidatesCapability, workPrepareTaskCapability] as const;

export function registerWorkAssistanceCapabilities(registry: Pick<CapabilityRegistry, "register">): void {
  for (const capability of WORK_ASSISTANCE_CAPABILITIES) (registry.register as (definition: unknown) => void)(capability);
}
