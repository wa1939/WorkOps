import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authz", () => ({ authorize: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { bulkInputSchema, bulkPlan, type BulkTask } from "./bulk";

const tasks: BulkTask[] = [
    {
        id: "t1",
        taskKey: "RES-0001",
        title: "First task",
        status: "TODO",
        priority: "MEDIUM",
        dueAt: new Date("2026-09-20T00:00:00.000Z"),
        estimateMinutes: 30,
        project: { id: "p1", name: "Research" },
        assignments: [{ userId: "u1", user: { name: "Nora" } }],
    },
    {
        id: "t2",
        taskKey: "RES-0002",
        title: "Second task",
        status: "DOING",
        priority: "HIGH",
        dueAt: null,
        estimateMinutes: null,
        project: { id: "p1", name: "Research" },
        assignments: [],
    },
];

describe("bulkInputSchema", () => {
    it("rejects an empty selection", () => {
        expect(() => bulkInputSchema.parse({
            action: "status",
            taskIds: [],
            payload: { status: "DONE" },
        })).toThrow();
    });

    it("accepts exactly 500 task ids and rejects 501", () => {
        const taskIds = Array.from({ length: 500 }, (_, index) => `task-${index}`);
        expect(() => bulkInputSchema.parse({
            action: "delete",
            taskIds,
            payload: {},
        })).not.toThrow();
        expect(() => bulkInputSchema.parse({
            action: "delete",
            taskIds: [...taskIds, "task-500"],
            payload: {},
        })).toThrow();
    });
});

describe("bulkPlan", () => {
    it.each([
        ["status", { status: "DONE" }, { action: "status", data: { status: "DONE" } }],
        ["priority", { priority: "URGENT" }, { action: "priority", data: { priority: "URGENT" } }],
        ["assignee", { mode: "set", userId: "u2" }, { action: "assignee", mode: "set", userId: "u2" }],
        ["tagAdd", { tagIds: ["tag-1"] }, { action: "tagAdd", tagIds: ["tag-1"] }],
        ["tagRemove", { tagIds: ["tag-1"] }, { action: "tagRemove", tagIds: ["tag-1"] }],
        ["archive", {}, { action: "archive", data: { archived: true } }],
        ["unarchive", {}, { action: "unarchive", data: { archived: false } }],
        ["delete", {}, { action: "delete" }],
        ["duplicate", { includeSubtasks: true, includeAttachments: true, includeAssignees: true }, {
            action: "duplicate",
            options: { includeSubtasks: true, includeAttachments: true, includeAssignees: true },
        }],
        ["export", {}, { action: "export" }],
    ] as const)("plans %s for every selected task", (action, payload, expected) => {
        const plan = bulkPlan(action, tasks, payload);
        expect(plan).toHaveLength(tasks.length);
        expect(plan[0]).toMatchObject({ taskId: "t1", ...expected });
        expect(plan[1]).toMatchObject({ taskId: "t2", ...expected });
    });

    it("produces user-facing export rows", () => {
        const [operation] = bulkPlan("export", tasks, {});
        expect(operation).toMatchObject({
            taskId: "t1",
            action: "export",
            row: {
                title: "First task",
                key: "RES-0001",
                status: "TODO",
                priority: "MEDIUM",
                assignees: "Nora",
                due: "2026-09-20T00:00:00.000Z",
                estimate: 30,
                project: "Research",
            },
        });
    });
});
