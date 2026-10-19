import { describe, expect, it, vi } from "vitest";
import {
    aggregateViewBlock,
    parseViewAggregateSearchParams,
    type ViewAggregateDatabase,
} from "./view-aggregate";
import type { SabahActor } from "./sabah/auth/actor";

const ACTOR: SabahActor = {
    id: "actor-1",
    role: "MEMBER",
    departmentIds: ["dept-1"],
};
const NOW = new Date("2026-10-07T22:30:00.000Z");

type RecordedCall = {
    delegate: string;
    args: Record<string, any>;
};

function makeDatabase() {
    const calls: RecordedCall[] = [];
    const raw = {
        task: {
            count: vi.fn(async (args: Record<string, any>) => {
                calls.push({ delegate: "task.count", args });
                return 0;
            }),
            groupBy: vi.fn(async (args: Record<string, any>) => {
                calls.push({ delegate: "task.groupBy", args });
                return [] as any[];
            }),
        },
        project: {
            count: vi.fn(async (args: Record<string, any>) => {
                calls.push({ delegate: "project.count", args });
                return 0;
            }),
            findMany: vi.fn(async (args: Record<string, any>) => {
                calls.push({ delegate: "project.findMany", args });
                return [] as any[];
            }),
        },
        kPI: {
            count: vi.fn(async (args: Record<string, any>) => {
                calls.push({ delegate: "kPI.count", args });
                return 0;
            }),
            groupBy: vi.fn(async (args: Record<string, any>) => {
                calls.push({ delegate: "kPI.groupBy", args });
                return [] as any[];
            }),
        },
    };

    Object.defineProperty(calls, "raw", { value: raw });
    return {
        raw,
        db: raw as unknown as ViewAggregateDatabase,
        calls,
    };
}

function taskCall(calls: RecordedCall[], delegate: "task.count" | "task.groupBy" = "task.count") {
    let call = calls.find((entry) => entry.delegate === delegate);
    if (!call) {
        const [delegateName, methodName] = delegate.split(".") as ["task", "count" | "groupBy"];
        const raw = (calls as RecordedCall[] & { raw?: Record<string, any> }).raw;
        const mockCalls = raw?.[delegateName]?.[methodName]?.mock?.calls ?? [];
        const args = mockCalls[mockCalls.length - 1]?.[0];
        if (args) call = { delegate, args };
    }
    expect(call).toBeDefined();
    return call!;
}

function taskBaseWhere(where: Record<string, any>): Record<string, any> {
    const base = where.AND?.find((part: any) => Array.isArray(part?.AND));
    expect(base).toBeDefined();
    return base;
}

describe("parseViewAggregateSearchParams", () => {
    it("parses one task metric and repeated/comma-encoded list filters", () => {
        expect(parseViewAggregateSearchParams(new URLSearchParams(
            "metric=my-due-week&assigneeIds=%40me&tagIds=tag-1,tag-2&projectId=p1&projectIds=p1,p2",
        ))).toMatchObject({
            metric: "my-due-week",
            taskScope: expect.objectContaining({
                assigneeIds: ["@me"],
                tagIds: ["tag-1", "tag-2"],
                projectId: "p1",
                projectIds: ["p1", "p2"],
            }),
        });

        expect(parseViewAggregateSearchParams(new URLSearchParams(
            "metric=my-open&status=TODO,DONE&status=DOING&tagIds=tag-1&tagIds=tag-2",
        ))).toMatchObject({
            taskScope: expect.objectContaining({
                status: ["TODO", "DONE", "DOING"],
                tagIds: ["tag-1", "tag-2"],
            }),
        });
    });

    it("rejects unknown, malformed, repeated-single, and dual selectors", () => {
        expect(() => parseViewAggregateSearchParams(new URLSearchParams("metric=not-a-metric"))).toThrow();
        expect(() => parseViewAggregateSearchParams(new URLSearchParams("metric=my-open&chartKind=task-by-status"))).toThrow();
        expect(() => parseViewAggregateSearchParams(new URLSearchParams("metric=my-open&metric=my-open"))).toThrow();
        expect(() => parseViewAggregateSearchParams(new URLSearchParams("metric=my-open&offset=50"))).toThrow();
        expect(() => parseViewAggregateSearchParams(new URLSearchParams("metric=my-open&unexpected=value"))).toThrow();
        expect(() => parseViewAggregateSearchParams(new URLSearchParams("metric=my-open&status=NOT_A_STATUS"))).toThrow();
        expect(() => parseViewAggregateSearchParams(new URLSearchParams("metric=my-open&dueAfter=tomorrow"))).toThrow();
        expect(() => parseViewAggregateSearchParams(new URLSearchParams("metric=my-open&projectId=p1&projectId=p2"))).toThrow();
    });

    it("rejects task scope for project and KPI selectors", () => {
        expect(() => parseViewAggregateSearchParams(new URLSearchParams(
            "metric=active-projects&priority=HIGH",
        ))).toThrow();
        expect(() => parseViewAggregateSearchParams(new URLSearchParams(
            "chartKind=kpi-status&workspaceId=workspace-1",
        ))).toThrow();
        expect(() => parseViewAggregateSearchParams(new URLSearchParams(
            "chartKind=kpi-status&groupBy=status",
        ))).toThrow();
    });
});

describe("aggregateViewBlock task metrics and charts", () => {
    it("intersects the normalized authorized task scope with my-open predicates", async () => {
        const { raw, db, calls } = makeDatabase();
        raw.task.count.mockResolvedValue(7);

        const response = await aggregateViewBlock({
            metric: "my-open",
            taskScope: {
                assigneeIds: ["@me"],
                tagIds: ["tag-1", "tag-2"],
                projectId: "project-1",
                projectIds: ["project-1", "project-2"],
                workspaceId: "workspace-1",
            },
            actor: ACTOR,
            now: NOW,
            db,
        });

        expect(response).toMatchObject({
            kind: "metric",
            key: "my-open",
            scope: "task",
            value: 7,
            totalCount: 7,
            timeZone: "Asia/Riyadh",
        });

        const where = taskCall(calls).args.where;
        expect(JSON.stringify(where)).toContain("actor-1");
        expect(JSON.stringify(where)).toContain("workspace-1");
        expect(JSON.stringify(where)).toContain("project-1");
        expect(JSON.stringify(where)).toContain("project-2");
        expect(JSON.stringify(where)).toContain("tag-1");
        expect(JSON.stringify(where)).toContain("tag-2");
        expect(where.AND).toEqual(expect.arrayContaining([
            {
                assignments: { some: { userId: "actor-1" } },
                status: { in: ["TODO", "DOING", "BLOCKED", "WAITING"] },
            },
        ]));

        const base = taskBaseWhere(where);
        expect(base.AND).toEqual(expect.arrayContaining([
            { projectId: "project-1" },
            { projectId: { in: ["project-1", "project-2"] } },
            { tags: { some: { tagId: { in: ["tag-1", "tag-2"] } } } },
        ]));
    });

    it("keeps singular and list project restrictions as an intersection", async () => {
        const { raw, db, calls } = makeDatabase();
        await aggregateViewBlock({
            metric: "team-overdue",
            taskScope: { projectId: "p1", projectIds: ["p2"] },
            actor: ACTOR,
            now: NOW,
            db,
        });

        const base = taskBaseWhere(taskCall(calls).args.where);
        expect(base.AND).toEqual(expect.arrayContaining([
            { projectId: "p1" },
            { projectId: { in: ["p2"] } },
        ]));
    });

    it("uses the shared Riyadh day bounds and excludes the exclusive end", async () => {
        const { raw, db, calls } = makeDatabase();
        raw.task.count.mockResolvedValue(2);

        const response = await aggregateViewBlock({
            metric: "my-due-today",
            actor: ACTOR,
            now: new Date("2026-10-07T21:00:00.000Z"),
            db,
        });

        expect(response).toMatchObject({
            window: {
                start: "2026-10-07T21:00:00.000Z",
                end: "2026-10-08T21:00:00.000Z",
            },
        });
        expect(taskCall(calls).args.where.AND).toEqual(expect.arrayContaining([
            {
                assignments: { some: { userId: "actor-1" } },
                status: { in: ["TODO", "DOING", "BLOCKED", "WAITING"] },
                dueAt: {
                    gte: new Date("2026-10-07T21:00:00.000Z"),
                    lt: new Date("2026-10-08T21:00:00.000Z"),
                },
            },
        ]));
    });

    it("uses the current Riyadh Sunday week and doneAt for completion metrics", async () => {
        const { raw, db, calls } = makeDatabase();
        raw.task.count.mockResolvedValue(3);

        const dueWeek = await aggregateViewBlock({
            metric: "my-due-week",
            actor: ACTOR,
            now: NOW,
            db,
        });
        expect(dueWeek).toMatchObject({
            window: {
                start: "2026-10-03T21:00:00.000Z",
                end: "2026-10-10T21:00:00.000Z",
            },
        });
        expect(taskCall(calls).args.where.AND).toEqual(expect.arrayContaining([
            expect.objectContaining({
                dueAt: {
                    gte: new Date("2026-10-03T21:00:00.000Z"),
                    lt: new Date("2026-10-10T21:00:00.000Z"),
                },
            }),
        ]));

        calls.length = 0;
        await aggregateViewBlock({
            metric: "team-done-week",
            actor: ACTOR,
            now: NOW,
            db,
        });
        const doneExtra = taskCall(calls).args.where.AND.find((part: any) => part.status?.in === undefined && part.doneAt);
        expect(doneExtra).toEqual({
            status: "DONE",
            doneAt: {
                gte: new Date("2026-10-03T21:00:00.000Z"),
                lt: new Date("2026-10-10T21:00:00.000Z"),
            },
        });
        expect(doneExtra.dueAt).toBeUndefined();

        calls.length = 0;
        await aggregateViewBlock({ metric: "my-done-week", actor: ACTOR, now: NOW, db });
        const myDoneWhere = taskCall(calls).args.where;
        expect(myDoneWhere.AND).toEqual(expect.arrayContaining([
            {
                assignments: { some: { userId: "actor-1" } },
                status: "DONE",
                doneAt: {
                    gte: new Date("2026-10-03T21:00:00.000Z"),
                    lt: new Date("2026-10-10T21:00:00.000Z"),
                },
            },
        ]));
        expect(JSON.stringify(myDoneWhere)).not.toContain("dueAt");
    });

    it("keeps contradictory date intersections fail-closed", async () => {
        const { raw, db } = makeDatabase();
        await expect(aggregateViewBlock({
            metric: "my-due-today",
            taskScope: {
                dueRange: "today",
                dueAfter: "2026-10-08T21:00:00.000Z",
            },
            actor: ACTOR,
            now: NOW,
            db,
        })).rejects.toThrow();
        expect(raw.task.count).not.toHaveBeenCalled();
    });

    it("groups duplicate project names by project ID and retains no-project tasks", async () => {
        const { raw, db, calls } = makeDatabase();
        raw.task.groupBy.mockResolvedValue([
            { projectId: "project-2", _count: { _all: 3 } },
            { projectId: null, _count: { _all: 2 } },
            { projectId: "project-1", _count: { _all: 4 } },
        ]);
        raw.project.findMany.mockResolvedValue([
            { id: "project-1", name: "Same name" },
            { id: "project-2", name: "Same name" },
        ]);

        const response = await aggregateViewBlock({
            chartKind: "task-by-project",
            actor: ACTOR,
            now: NOW,
            db,
        });

        expect(response).toMatchObject({
            kind: "chart",
            key: "task-by-project",
            totalCount: 9,
            points: [
                { key: "__no-project__", label: "No project", value: 2 },
                { key: "project-1", label: "Same name", value: 4 },
                { key: "project-2", label: "Same name", value: 3 },
            ],
        });
        expect(taskCall(calls, "task.groupBy").args.by).toEqual(["projectId"]);
        expect(raw.project.findMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                AND: expect.arrayContaining([{ id: { in: ["project-2", "project-1"] } }]),
            }),
            select: { id: true, name: true },
        });
    });

    it("returns canonical status and priority ordering from grouped counts", async () => {
        const { raw, db } = makeDatabase();
        raw.task.groupBy
            .mockResolvedValueOnce([
                { status: "DONE", _count: { _all: 2 } },
                { status: "TODO", _count: { _all: 5 } },
            ])
            .mockResolvedValueOnce([
                { priority: "LOW", _count: { _all: 1 } },
                { priority: "URGENT", _count: { _all: 4 } },
            ]);

        const statuses = await aggregateViewBlock({ chartKind: "task-by-status", actor: ACTOR, now: NOW, db });
        const priorities = await aggregateViewBlock({ chartKind: "task-by-priority", actor: ACTOR, now: NOW, db });

        expect(statuses).toMatchObject({
            points: [
                { key: "TODO", label: "TODO", value: 5 },
                { key: "DONE", label: "DONE", value: 2 },
            ],
            totalCount: 7,
        });
        expect(priorities).toMatchObject({
            points: [
                { key: "URGENT", label: "URGENT", value: 4 },
                { key: "LOW", label: "LOW", value: 1 },
            ],
            totalCount: 5,
        });
    });

    it("returns fourteen Riyadh completion buckets with server-side counts", async () => {
        const { raw, db, calls } = makeDatabase();
        let count = 0;
        raw.task.count.mockImplementation(async (args: Record<string, any>) => {
            calls.push({ delegate: "task.count", args });
            count += 1;
            return count;
        });

        const response = await aggregateViewBlock({
            chartKind: "task-completion-trend",
            actor: ACTOR,
            now: NOW,
            db,
        });

        expect(response).toMatchObject({
            kind: "chart",
            key: "task-completion-trend",
            window: {
                start: "2026-09-24T21:00:00.000Z",
                end: "2026-10-08T21:00:00.000Z",
            },
        });
        expect(response.kind).toBe("chart");
        if (response.kind === "chart") {
            expect(response.points).toHaveLength(14);
            expect(response.points.map((point) => point.key)).toEqual([
                "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01",
                "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08",
            ]);
            expect(response.points.map((point) => point.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
            expect(response.totalCount).toBe(response.points.reduce((total, point) => total + point.value, 0));
        }
        expect(raw.task.count).toHaveBeenCalledTimes(14);
        expect(calls.filter((call) => call.delegate === "task.count")).toHaveLength(14);
    });

    it("propagates database failures instead of converting them to empty success", async () => {
        const { raw, db } = makeDatabase();
        const failure = new Error("sentinel database failure");
        raw.task.count.mockRejectedValue(failure);

        await expect(aggregateViewBlock({
            metric: "my-open",
            actor: ACTOR,
            now: NOW,
            db,
        })).rejects.toBe(failure);
    });
});

describe("aggregateViewBlock project and KPI policies", () => {
    it("uses exact inactive project statuses without inheriting task scope", async () => {
        const { raw, db, calls } = makeDatabase();
        raw.project.count.mockResolvedValue(8);

        const response = await aggregateViewBlock({
            metric: "active-projects",
            taskScope: { priority: ["HIGH"], workspaceId: "workspace-1" },
            actor: ACTOR,
            now: NOW,
            db,
        }).catch((error: unknown) => {
            expect(error).toBeInstanceOf(Error);
            return null;
        });

        expect(response).toBeNull();
        expect(raw.project.count).not.toHaveBeenCalled();

        const clean = await aggregateViewBlock({ metric: "active-projects", actor: ACTOR, now: NOW, db });
        expect(clean).toMatchObject({ value: 8, totalCount: 8, scope: "project" });
        const projectCountCalls = raw.project.count.mock.calls;
        const projectCountArgs = projectCountCalls[projectCountCalls.length - 1]?.[0];
        expect(projectCountArgs?.where).toEqual({
            AND: [
                expect.objectContaining({ OR: expect.any(Array) }),
                { status: { notIn: ["Done", "Archived"] } },
            ],
        });
    });

    it("requires department-level KPI read authorization before any delegate call", async () => {
        const { raw, db } = makeDatabase();
        const noDepartmentActor: SabahActor = { ...ACTOR, departmentIds: [] };

        await expect(aggregateViewBlock({
            metric: "on-track-kpis",
            actor: noDepartmentActor,
            now: NOW,
            db,
        })).rejects.toMatchObject({ status: 403 });
        await expect(aggregateViewBlock({
            chartKind: "kpi-status",
            actor: noDepartmentActor,
            now: NOW,
            db,
        })).rejects.toMatchObject({ status: 403 });
        expect(raw.kPI.count).not.toHaveBeenCalled();
        expect(raw.kPI.groupBy).not.toHaveBeenCalled();
    });

    it("uses exact uppercase KPI statuses and stable status chart order", async () => {
        const { raw, db } = makeDatabase();
        raw.kPI.count.mockResolvedValue(6);
        raw.kPI.groupBy.mockResolvedValue([
            { status: "OFF_TRACK", _count: { _all: 2 } },
            { status: "ON_TRACK", _count: { _all: 3 } },
            { status: "AT_RISK", _count: { _all: 1 } },
        ]);

        const metric = await aggregateViewBlock({ metric: "on-track-kpis", actor: ACTOR, now: NOW, db });
        const chart = await aggregateViewBlock({ chartKind: "kpi-status", actor: ACTOR, now: NOW, db });

        expect(metric).toMatchObject({ value: 6, totalCount: 6 });
        expect(raw.kPI.count).toHaveBeenCalledWith({ where: { status: "ON_TRACK" } });
        expect(chart).toMatchObject({
            points: [
                { key: "ON_TRACK", label: "ON_TRACK", value: 3 },
                { key: "AT_RISK", label: "AT_RISK", value: 1 },
                { key: "OFF_TRACK", label: "OFF_TRACK", value: 2 },
            ],
            totalCount: 6,
        });
        expect(raw.kPI.groupBy).toHaveBeenCalledWith({
            by: ["status"],
            where: {},
            _count: { _all: true },
        });
    });
});
