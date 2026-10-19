import { describe, expect, it } from "vitest";
import { buildTaskGridQuery, deriveGroups, taskGridInputSchema, type TaskGridRow } from "./grid-query";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function row(overrides: Partial<TaskGridRow> & Pick<TaskGridRow, "id">): TaskGridRow {
    const { id, ...rest } = overrides;
    return {
        id,
        taskKey: null,
        title: id,
        status: "TODO",
        priority: "MEDIUM",
        dueAt: null,
        estimateMinutes: null,
        updatedAt: NOW,
        createdAt: NOW,
        assignments: [],
        ...rest,
    };
}

describe("task grid input", () => {
    it("defaults the grid controls and validates ISO cursor dates", () => {
        expect(taskGridInputSchema.parse({})).toMatchObject({
            filters: {
                status: [],
                priority: [],
                assigneeIds: [],
                tagIds: [],
                includeArchived: false,
            },
            groupBy: "none",
            sortBy: "updatedAt",
            dir: "desc",
        });

        expect(() => taskGridInputSchema.parse({
            cursor: { updatedAt: "not-a-date", id: "task-1" },
        })).toThrow();
    });
});

describe("task grid query", () => {
    it("excludes archived tasks by default and includes them only when requested", () => {
        const viewer = { id: "user-1", role: "MEMBER", departmentIds: [] };
        const base = {
            groupBy: "none" as const,
            sortBy: "updatedAt" as const,
            dir: "desc" as const,
        };
        const filters = {
            status: [],
            priority: [],
            assigneeIds: [],
            tagIds: [],
            includeArchived: false,
        };
        const activeQuery = buildTaskGridQuery({ ...base, filters }, viewer);
        const archivedQuery = buildTaskGridQuery({ ...base, filters: { ...filters, includeArchived: true } }, viewer);

        expect((activeQuery.where as { AND: unknown[] }).AND).toContainEqual({ archived: false });
        expect((archivedQuery.where as { AND: unknown[] }).AND).not.toContainEqual({ archived: false });
    });

    it("whitelists sorting and composes filters with viewer visibility scopes", () => {
        const query = buildTaskGridQuery({
            filters: {
                status: ["DONE"],
                priority: ["URGENT"],
                assigneeIds: ["user-2"],
                tagIds: ["tag-1"],
                projectId: "project-1",
                workspaceId: "workspace-1",
                search: "release",
                includeArchived: false,
                dueBefore: "2026-09-30T00:00:00.000Z",
                dueAfter: "2026-09-01T00:00:00.000Z",
            },
            groupBy: "status",
            sortBy: "dueDate",
            dir: "asc",
        }, { id: "user-1", role: "MEMBER", departmentIds: [] });

        expect(query.orderBy).toEqual([{ dueAt: "asc" }, { id: "asc" }]);
        expect(query.include).toMatchObject({ assignments: expect.anything(), tags: expect.anything(), project: expect.anything() });
        const where = query.where as { AND: unknown[] };
        expect(where.AND).toEqual(expect.arrayContaining([
            { status: { in: ["DONE"] } },
            { priority: { in: ["URGENT"] } },
            { projectId: "project-1" },
        ]));
    });

    it("intersects a legacy projectId with a validated projectIds list", () => {
        const query = buildTaskGridQuery(taskGridInputSchema.parse({
            filters: {
                projectId: "project-1",
                projectIds: ["project-1", "project-2"],
                statusNotIn: ["DONE", "CANCELED"],
            },
        }), { id: "user-1", role: "MEMBER", departmentIds: [] });

        const where = query.where as { AND: unknown[] };
        expect(where.AND).toEqual(expect.arrayContaining([
            { projectId: "project-1" },
            { projectId: { in: ["project-1", "project-2"] } },
            { status: { notIn: ["DONE", "CANCELED"] } },
        ]));
    });
});

describe("deriveGroups", () => {
    const rows: TaskGridRow[] = [
        row({
            id: "todo",
            status: "TODO",
            priority: "HIGH",
            dueAt: new Date("2026-09-15T12:00:00.000Z"),
            estimateMinutes: 30,
            assignments: [{ userId: "u1", user: { image: "/u1.png" } }],
        }),
        row({
            id: "done",
            status: "DONE",
            priority: "HIGH",
            dueAt: new Date("2026-09-13T12:00:00.000Z"),
            estimateMinutes: 60,
            assignments: [{ userId: "u2", user: { image: "/u2.png" } }],
        }),
        row({
            id: "overdue",
            status: "DOING",
            priority: "LOW",
            dueAt: new Date("2026-09-14T11:59:59.999Z"),
            estimateMinutes: null,
            assignments: [{ userId: "u1", user: { image: "/u1.png" } }],
        }),
        row({
            id: "boundary",
            status: "DOING",
            priority: "LOW",
            dueAt: NOW,
            estimateMinutes: 15,
            assignments: [{ userId: "u3", user: { image: null } }],
        }),
    ];

    it("groups by status and counts done, overdue, estimates, and avatar samples", () => {
        expect(deriveGroups(rows, "status", NOW)).toEqual([
            {
                key: "TODO",
                label: "TODO",
                count: 1,
                doneCount: 0,
                overdueCount: 0,
                estimateMinutes: 30,
                assigneeAvatars: ["/u1.png"],
            },
            {
                key: "DONE",
                label: "DONE",
                count: 1,
                doneCount: 1,
                overdueCount: 0,
                estimateMinutes: 60,
                assigneeAvatars: ["/u2.png"],
            },
            {
                key: "DOING",
                label: "DOING",
                count: 2,
                doneCount: 0,
                overdueCount: 1,
                estimateMinutes: 15,
                assigneeAvatars: ["/u1.png"],
            },
        ]);
    });

    it("groups by assignee, including unassigned tasks without double-counting a group row", () => {
        const grouped = deriveGroups([
            row({ id: "multi", status: "DOING", estimateMinutes: 20, assignments: [
                { userId: "u1", user: { image: "/u1.png" } },
                { userId: "u2", user: { image: "/u2.png" } },
            ] }),
            row({ id: "unassigned", status: "TODO", estimateMinutes: 10 }),
        ], "assignee", NOW);

        expect(grouped).toEqual([
            expect.objectContaining({ key: "u1", count: 1, estimateMinutes: 20, assigneeAvatars: ["/u1.png"] }),
            expect.objectContaining({ key: "u2", count: 1, estimateMinutes: 20, assigneeAvatars: ["/u2.png"] }),
            expect.objectContaining({ key: "unassigned", label: "Unassigned", count: 1, estimateMinutes: 10 }),
        ]);
    });

    it("returns one all-tasks group when grouping is disabled", () => {
        expect(deriveGroups(rows, "none", NOW)).toEqual([
            expect.objectContaining({ key: "all", label: "All tasks", count: 4, doneCount: 1, overdueCount: 1, estimateMinutes: 105 }),
        ]);
    });
});
