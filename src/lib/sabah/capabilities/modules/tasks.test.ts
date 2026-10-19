import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskSchema, updateTaskSchema } from "@/lib/tasks/schemas";
import * as commands from "@/lib/tasks/commands";
import {
    TASK_CAPABILITIES,
    registerTaskCapabilities,
    tasksSearchCapability,
    tasksGetCapability,
    tasksCreateCapability,
    tasksCreateManyCapability,
    tasksUpdateCapability,
    tasksUpdateStatusCapability,
    tasksReassignCapability,
    tasksAddDependenciesCapability,
    tasksCommentCapability,
    tasksCancelCreatedCapability,
} from "./tasks";
import type { DuplicateDb, DuplicateRecord } from "@/lib/sabah/intelligence/duplicates";

vi.mock("@/lib/tasks/commands", () => ({
    createTask: vi.fn(), createTasks: vi.fn(), updateTask: vi.fn(), updateTaskStatus: vi.fn(),
    reassignTask: vi.fn(), addTaskDependencies: vi.fn(), listTasksForActor: vi.fn(),
    getTaskForActor: vi.fn(), cancelCreatedTasks: vi.fn(), resolveTaskAssigneeLabels: vi.fn(),
}));

const member = { id: "u1", role: "MEMBER" as const, departmentIds: [] };
const viewer = { id: "u2", role: "VIEWER" as const, departmentIds: [] };
const context = { actor: member, requestId: "r1", conversationId: null, workflowId: null, now: new Date(), duplicateDb: { scopeDb: { task: { findMany: vi.fn(async () => []) } }, loadCandidates: vi.fn(async () => []) } };
const task = { id: "t1", title: "Write report", status: "TODO", priority: "MEDIUM", createdById: "u1", updatedAt: new Date() };
function taskDuplicateDb(rows: DuplicateRecord[]): DuplicateDb {
    return {
        scopeDb: { task: { findMany: vi.fn(async () => rows.map((row) => ({ id: row.id, isPrivate: false, createdById: member.id, assignments: [] }))) } },
        loadCandidates: vi.fn(async () => rows),
    };
}

beforeEach(() => vi.clearAllMocks());

describe("task capability registration", () => {
    it("exports exactly the reviewed names and no delete", () => {
        expect(TASK_CAPABILITIES.map((c) => c.name)).toEqual([
            "tasks.search", "tasks.get", "tasks.create", "tasks.createMany", "tasks.update",
            "tasks.updateStatus", "tasks.reassign", "tasks.addDependencies", "tasks.comment", "tasks.cancelCreated",
        ]);
        expect(TASK_CAPABILITIES.some((c) => c.name === "tasks.delete")).toBe(false);
    });
    it("registers all ten capabilities", () => {
        const registry = { register: vi.fn() };
        registerTaskCapabilities(registry);
        expect(registry.register).toHaveBeenCalledTimes(10);
    });
    it("keeps command schema parity", () => {
        expect(tasksCreateCapability.inputSchema).toBe(createTaskSchema);
        expect(tasksUpdateCapability.inputSchema.safeParse({ id: "t1", title: "x" }).success).toBe(true);
        expect(tasksUpdateCapability.inputSchema.safeParse({ id: "t1", title: "x", expectedUpdatedAt: "bad" }).success).toBe(false);
        expect(updateTaskSchema.safeParse({ title: "x" }).success).toBe(true);
        expect(createTaskSchema.safeParse({ title: "x", status: "INVALID" }).success).toBe(false);
        expect(createTaskSchema.safeParse({ title: "x", projectId: "" }).success).toBe(false);
        expect(createTaskSchema.safeParse({ title: "x", assigneeIds: [""] }).success).toBe(false);
        expect(updateTaskSchema.safeParse({ effortHours: -1 }).success).toBe(false);
    });
});

describe("privacy, authorization, previews, and verification", () => {
    it("blocks an exact duplicate during direct execution without optional context keys", async () => {
        const duplicateDb = taskDuplicateDb([{ id: "t-existing", title: "Write report", description: "details", updatedAt: new Date("2026-08-20"), isPrivate: false }]);
        await expect(tasksCreateCapability.authorize({ title: "Write report", description: "details" }, { ...context, duplicateDb })).rejects.toMatchObject({ code: "DUPLICATE_WORK", status: 409 });
        await expect(tasksCreateCapability.execute({ title: "Write report", description: "details" }, { ...context, duplicateDb })).rejects.toMatchObject({ code: "DUPLICATE_WORK", status: 409 });
        expect(commands.createTask).not.toHaveBeenCalled();
    });

    it("propagates idempotency keys into direct previews", async () => {
        const lookup = vi.fn(async () => ({ id: "workflow-1", updatedAt: new Date("2026-08-20") }));
        const duplicateDb = { ...taskDuplicateDb([]), findExistingIdempotentWorkflow: lookup };
        const preview = await tasksCreateCapability.preview({ title: "Write report" }, { ...context, idempotencyKey: "retry-1", duplicateDb });
        expect(lookup).toHaveBeenCalledWith("retry-1", member.id);
        expect(preview.warnings?.join(" ")).toMatch(/Exact duplicate/i);
    });

    it("previews likely duplicates as structured choices without creating", async () => {
        const preview = await tasksCreateCapability.preview(
            { title: "Write report", description: "new details" },
            { ...context, duplicateDb: taskDuplicateDb([{ id: "t-existing", title: "Write report", description: "old details", updatedAt: new Date("2026-08-20"), isPrivate: false }]) },
        );
        expect(preview.warnings?.join(" ")).toMatch(/Likely duplicate/i);
        expect(preview.duplicateChoices?.some((choice) => choice.action === "USE_EXISTING")).toBe(true);
        expect(commands.createTask).not.toHaveBeenCalled();
    });
    it("allows viewer reads but not writes", async () => {
        await expect(tasksSearchCapability.available(viewer)).resolves.toBe(true);
        await expect(tasksGetCapability.available(viewer)).resolves.toBe(true);
        await expect(tasksCreateCapability.available(viewer)).resolves.toBe(false);
        await expect(tasksUpdateCapability.available(viewer)).resolves.toBe(false);
        await expect(tasksCancelCreatedCapability.available(viewer)).resolves.toBe(false);
    });
    it("searches and gets through actor-scoped commands", async () => {
        vi.mocked(commands.listTasksForActor).mockResolvedValue([task] as never);
        vi.mocked(commands.getTaskForActor).mockResolvedValue(task as never);
        expect(await tasksSearchCapability.execute({ query: "report" }, { ...context, actor: viewer })).toEqual([expect.objectContaining({ id: "t1" })]);
        expect(await tasksGetCapability.execute({ id: "t1" }, { ...context, actor: viewer })).toEqual(task);
        expect(commands.listTasksForActor).toHaveBeenCalledWith(expect.objectContaining({ search: "report" }), viewer);
        expect(commands.getTaskForActor).toHaveBeenCalledWith("t1", viewer);
    });
    it("previews labels, current/proposed values, and child counts", async () => {
        vi.mocked(commands.getTaskForActor).mockResolvedValue({ ...task, project: { id: "p1", name: "Project One" }, assignments: [{ userId: "u1", user: { name: "A" } }], tags: [{ tagId: "tag1", tag: { name: "Urgent" } }], dependencies: [{ dependsOn: { id: "t2", title: "Prior task" } }] } as never);
        const preview = await tasksUpdateCapability.preview({ id: "t1", title: "New title", projectId: "p2", assigneeIds: ["u2"], tagIds: ["tag2"], dependencyIds: ["t3"] }, context);
        expect(preview.fields.find((f) => f.path === "title")).toMatchObject({ current: "Write report", proposed: "New title" });
        expect(preview.fields.some((f) => f.path === "projectId" && String(f.current).includes("Project One"))).toBe(true);
        expect(preview.fields.some((f) => f.path === "assigneeIds" && String(f.current).includes("1"))).toBe(true);
        expect(preview.warnings?.some((w) => /replace|dependency/i.test(w))).toBe(true);
    });
    it("resolves proposed assignee labels without exposing raw IDs", async () => {
        vi.mocked(commands.getTaskForActor).mockResolvedValue(task as never);
        vi.mocked(commands.resolveTaskAssigneeLabels).mockResolvedValue(new Map([["u2", "New Owner"]]) as never);
        const preview = await tasksReassignCapability.preview({ id: "t1", assigneeIds: ["u2", "hidden"] }, context);
        expect(preview.fields[0]).toMatchObject({ proposed: "New Owner, (not visible)" });
        expect(String(preview.fields[0].proposed)).not.toContain("u2");
        expect(String(preview.fields[0].proposed)).not.toContain("hidden");
    });
    it("verifies writes by actor-scoped read-back", async () => {
        vi.mocked(commands.createTask).mockResolvedValue(task as never);
        vi.mocked(commands.getTaskForActor).mockResolvedValue(task as never);
        const output = await tasksCreateCapability.execute({ title: "Write report" }, context);
        expect(commands.createTask).toHaveBeenCalledWith({ title: "Write report" }, member);
        expect(await tasksCreateCapability.verify(output, context)).toEqual({
            ...task,
            entityLinks: [{ type: "TASK", id: task.id, href: "/tasks/t1", label: task.title }],
        });
    });
    it("builds task links from the actor-scoped read-back, not supplied result links", async () => {
        vi.mocked(commands.getTaskForActor).mockResolvedValue(task as never);
        const verified = await tasksGetCapability.verify({ ...task, entityLinks: [{ type: "TASK", id: "forged", href: "/tasks/forged", label: "Forged" }] }, context);
        expect(verified.entityLinks).toEqual([{ type: "TASK", id: task.id, href: "/tasks/t1", label: task.title }]);
        expect(commands.getTaskForActor).toHaveBeenCalledWith(task.id, member);
    });
    it("rejects a mismatched read-back", async () => {
        vi.mocked(commands.getTaskForActor).mockResolvedValue({ ...task, title: "Different" } as never);
        await expect(tasksCreateCapability.verify(task as never, context)).rejects.toMatchObject({ code: "VERIFY_FAILED" });
    });
});

describe("write risk and safe undo", () => {
    it("escalates bulk, reassignment, and non-empty replacements", () => {
        expect((tasksCreateManyCapability.risk as Function)({ tasks: [{ title: "a" }, { title: "b" }] }, context)).toBe("BULK_WRITE");
        expect((tasksReassignCapability.risk as Function)({ id: "t1", assigneeIds: ["u2"] }, context)).toBe("SENSITIVE_WRITE");
        expect((tasksUpdateCapability.risk as Function)({ id: "t1", assigneeIds: ["u2"] }, context)).toBe("SENSITIVE_WRITE");
        expect((tasksUpdateCapability.risk as Function)({ id: "t1", tagIds: [] }, context)).toBe("REVERSIBLE_WRITE");
    });
    it("protects duplicate IDs before invoking commands", async () => {
        await expect(tasksCreateCapability.execute({ title: "x", assigneeIds: ["u1", "u1"] }, context)).rejects.toThrow(/duplicate/i);
        expect(commands.createTask).not.toHaveBeenCalled();
    });
    it("caps batches and exposes allowPartial policy", async () => {
        const input = Array.from({ length: 101 }, () => ({ title: "x" }));
        expect(tasksCreateManyCapability.inputSchema.safeParse({ tasks: input, allowPartial: true }).success).toBe(false);
        const preview = await tasksCreateManyCapability.preview({ tasks: [{ title: "x" }], allowPartial: true }, context);
        expect(preview.fields.some((f) => f.path === "allowPartial")).toBe(true);
    });
    it("binds bounded task titles and dates into a createMany preview", async () => {
        const preview = await tasksCreateManyCapability.preview({
            tasks: Array.from({ length: 6 }, (_, index) => ({
                title: `Task ${index + 1}`,
                startAt: `2026-09-${String(index + 7).padStart(2, "0")}T09:00:00+03:00`,
                dueAt: `2026-09-${String(index + 7).padStart(2, "0")}T17:00:00+03:00`,
                dueAtEnd: `2026-09-${String(index + 7).padStart(2, "0")}T18:00:00+03:00`,
            })),
            allowPartial: false,
        }, context);

        expect(preview.title).toContain("Task 1");
        expect(preview.title).toContain("2026-09-07");
        expect(preview.title).toContain("Task 6");
        expect(preview.title.length).toBeLessThanOrEqual(500);
        expect(preview.fields.find((field) => field.path === "tasks")?.proposed).toContain("Task 1");
        expect(preview.fields.find((field) => field.path === "tasks")?.proposed).not.toContain("startAt");
    });
    it("verifies every successful batch item against its actor-scoped read-back", async () => {
        const batch = Array.from({ length: 6 }, (_, index) => ({
            ok: true,
            index,
            data: { ...task, id: `batch-${index + 1}`, title: `Task ${index + 1}` },
        }));
        vi.mocked(commands.createTasks).mockResolvedValue(batch as never);
        vi.mocked(commands.getTaskForActor).mockImplementation(async (id) => ({ ...task, id, title: `Task ${String(id).replace("batch-", "")}` }) as never);

        const input = {
            tasks: Array.from({ length: 6 }, (_, index) => ({ title: `Task ${index + 1}`, dueAt: index < 2 ? "2026-09-06T23:59:59+03:00" : "2026-09-07T23:59:59+03:00" })),
            allowPartial: false,
        };
        const output = await tasksCreateManyCapability.execute(input, context);

        await expect(tasksCreateManyCapability.verify(output, context)).resolves.toEqual(output);
        expect(commands.createTasks).toHaveBeenCalledWith(input.tasks, member, undefined, { allowPartial: false });
        expect(commands.getTaskForActor).toHaveBeenCalledTimes(6);
    });
    it("delegates dependency cycles to command and warns in preview", async () => {
        vi.mocked(commands.addTaskDependencies).mockRejectedValue(Object.assign(new Error("Dependency cycle"), { code: "DEPENDENCY_CYCLE" }));
        const preview = await tasksAddDependenciesCapability.preview({ id: "t1", dependencyIds: ["t1"] }, context);
        expect(preview.warnings?.join(" ")).toMatch(/cycle/i);
        await expect(tasksAddDependenciesCapability.execute({ id: "t1", dependencyIds: ["t1"] }, context)).rejects.toMatchObject({ code: "DEPENDENCY_CYCLE" });
    });
    it("cancels only creator-owned standard tasks and has no compensation/delete", async () => {
        vi.mocked(commands.cancelCreatedTasks).mockResolvedValue({ canceledIds: ["t1"], rejectedIds: [] });
        const result = await tasksCancelCreatedCapability.execute({ ids: ["t1"] }, context);
        expect(commands.cancelCreatedTasks).toHaveBeenCalledWith(["t1"], member);
        expect(result).toEqual({ canceledIds: ["t1"], rejectedIds: [] });
        expect(tasksCancelCreatedCapability.compensate).toBeDefined();
        await expect(tasksCancelCreatedCapability.compensate?.(result, context)).rejects.toThrow(/undo|delete/i);
        expect(TASK_CAPABILITIES.some((c) => c.name.includes("delete"))).toBe(false);
    });
});
