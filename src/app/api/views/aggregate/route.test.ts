import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, toSabahActor, taskCount, taskGroupBy, taskFindMany, projectCount, projectFindMany, kpiCount, kpiGroupBy } = vi.hoisted(() => ({
    auth: vi.fn(),
    toSabahActor: vi.fn(),
    taskCount: vi.fn(),
    taskGroupBy: vi.fn(),
    taskFindMany: vi.fn(),
    projectCount: vi.fn(),
    projectFindMany: vi.fn(),
    kpiCount: vi.fn(),
    kpiGroupBy: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/sabah/auth/actor", () => ({
    toSabahActor,
    SabahForbiddenError: class SabahForbiddenError extends Error {
        readonly status = 403;
        readonly code = "SABAH_FORBIDDEN";
    },
}));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        task: { count: taskCount, groupBy: taskGroupBy, findMany: taskFindMany },
        project: { count: projectCount, findMany: projectFindMany },
        kPI: { count: kpiCount, groupBy: kpiGroupBy },
    },
}));
vi.mock("@/lib/view-aggregate", async () => {
    const actual = await vi.importActual<typeof import("@/lib/view-aggregate")>("@/lib/view-aggregate");
    return {
        ...actual,
        parseViewAggregateSearchParams: vi.fn(actual.parseViewAggregateSearchParams),
        aggregateViewBlock: vi.fn(actual.aggregateViewBlock),
    };
});

import { aggregateViewBlock, parseViewAggregateSearchParams } from "@/lib/view-aggregate";
import { GET } from "./route";

type AggregatePayload = {
    kind: "metric" | "chart";
    key: string;
    scope: string;
    value?: number;
    totalCount: number;
    points?: Array<{ key: string; label: string; value: number }>;
};

type SabahActorLike = {
    id: string;
    role: "ADMIN" | "LEAD" | "MEMBER" | "VIEWER";
    departmentIds: string[];
};

const actor: SabahActorLike = {
    id: "actor-1",
    role: "MEMBER",
    departmentIds: ["dept-1"],
};

function request(query = ""): Request {
    return new Request(`http://localhost/api/views/aggregate${query ? `?${query}` : ""}`);
}

function responseBody(response: Response): Promise<AggregatePayload | { error: unknown }> {
    return response.json() as Promise<AggregatePayload | { error: unknown }>;
}

function mockedAggregate() {
    return vi.mocked(aggregateViewBlock);
}

function mockedParser() {
    return vi.mocked(parseViewAggregateSearchParams);
}

describe("GET /api/views/aggregate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-07T22:30:00.000Z"));
        auth.mockResolvedValue({ user: { id: "session-user", role: "VIEWER", departmentIds: [] } });
        toSabahActor.mockResolvedValue(actor);
        taskCount.mockResolvedValue(0);
        taskGroupBy.mockResolvedValue([]);
        taskFindMany.mockResolvedValue([]);
        projectCount.mockResolvedValue(0);
        projectFindMany.mockResolvedValue([]);
        kpiCount.mockResolvedValue(0);
        kpiGroupBy.mockResolvedValue([]);
    });

    it("returns 401 before parsing or any delegate call without an authenticated session", async () => {
        auth.mockResolvedValue(null);

        const response = await GET(request("metric=not-a-metric"));

        expect(response.status).toBe(401);
        expect(toSabahActor).not.toHaveBeenCalled();
        expect(mockedParser()).not.toHaveBeenCalled();
        expect(mockedAggregate()).not.toHaveBeenCalled();
        expect(taskCount).not.toHaveBeenCalled();
        expect(taskGroupBy).not.toHaveBeenCalled();
        expect(projectCount).not.toHaveBeenCalled();
        expect(kpiCount).not.toHaveBeenCalled();
    });

    it("returns bounded 400 responses for invalid selectors, filters, paging, and unsupported KPI scope", async () => {
        const invalidQueries = [
            "metric=not-a-metric",
            "chartKind=not-a-chart",
            "metric=my-open&chartKind=task-by-status",
            "metric=my-open&offset=50",
            "metric=my-open&groupBy=project",
            "metric=my-open&status=NOT_A_STATUS",
            "metric=my-open&dueRange=tomorrow",
            "metric=my-open&dueAfter=not-a-date",
            "metric=my-open&projectIds=,",
            "metric=my-open&userId=attacker-id",
            "chartKind=kpi-status&priority=HIGH",
        ];

        for (const query of invalidQueries) {
            const response = await GET(request(query));
            expect(response.status, query).toBe(400);
            expect((await responseBody(response)) as { error: unknown }).toHaveProperty("error");
        }

        expect(mockedAggregate()).not.toHaveBeenCalled();
        expect(taskCount).not.toHaveBeenCalled();
        expect(taskGroupBy).not.toHaveBeenCalled();
        expect(projectCount).not.toHaveBeenCalled();
        expect(kpiCount).not.toHaveBeenCalled();
    });

    it("returns an exact task metric, uses no task rows, and keeps the authorized base for grouped counts", async () => {
        taskCount.mockResolvedValueOnce(137);
        taskGroupBy.mockResolvedValueOnce([
            { status: "TODO", _count: { _all: 101 } },
            { status: "DONE", _count: { _all: 36 } },
        ]);
        const scope = "workspaceId=workspace-1&projectId=project-a&tagIds=tag-1,tag-2&assigneeIds=%40me&dueRange=today";

        const metricResponse = await GET(request(`metric=my-open&${scope}`));
        expect(metricResponse.status).toBe(200);
        expect(await responseBody(metricResponse)).toMatchObject({
            kind: "metric",
            key: "my-open",
            value: 137,
            totalCount: 137,
            timeZone: "Asia/Riyadh",
        });

        const chartResponse = await GET(request(`chartKind=task-by-status&${scope}`));
        expect(chartResponse.status).toBe(200);
        expect(await responseBody(chartResponse)).toMatchObject({
            kind: "chart",
            key: "task-by-status",
            totalCount: 137,
            points: [
                { key: "TODO", label: "TODO", value: 101 },
                { key: "DONE", label: "DONE", value: 36 },
            ],
        });

        expect(taskCount).toHaveBeenCalledTimes(1);
        expect(taskGroupBy).toHaveBeenCalledTimes(1);
        expect(taskFindMany).not.toHaveBeenCalled();
        const countWhere = taskCount.mock.calls[0][0].where as { AND: unknown[] };
        const groupWhere = taskGroupBy.mock.calls[0][0].where;
        expect(groupWhere).toEqual(countWhere.AND[0]);

        const whereText = JSON.stringify(countWhere);
        expect(whereText).toContain("actor-1");
        expect(whereText).toContain("workspace-1");
        expect(whereText).toContain("project-a");
        expect(whereText).toContain("tag-1");
        expect(whereText).toContain("tag-2");
        expect(whereText).toContain("archived");
        expect(whereText).toContain("2026-10-07T21:00:00.000Z");
    });

    it("keeps duplicate project names as ID-keyed points and includes the null-project bucket", async () => {
        taskGroupBy.mockResolvedValue([
            { projectId: "project-a", _count: { _all: 4 } },
            { projectId: "project-b", _count: { _all: 3 } },
            { projectId: null, _count: { _all: 2 } },
        ]);
        projectFindMany.mockResolvedValue([
            { id: "project-a", name: "Same name" },
            { id: "project-b", name: "Same name" },
        ]);

        const response = await GET(request("chartKind=task-by-project"));

        expect(response.status).toBe(200);
        expect(await responseBody(response)).toMatchObject({
            kind: "chart",
            key: "task-by-project",
            totalCount: 9,
            points: [
                { key: "__no-project__", label: "No project", value: 2 },
                { key: "project-a", label: "Same name", value: 4 },
                { key: "project-b", label: "Same name", value: 3 },
            ],
        });
        expect(projectFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                AND: expect.arrayContaining([
                    expect.objectContaining({ id: { in: ["project-a", "project-b"] } }),
                ]),
            }),
            select: { id: true, name: true },
        }));
        expect(taskFindMany).not.toHaveBeenCalled();
    });

    it("uses the project visibility policy and exact inactive status literals without task-chip scope", async () => {
        projectCount.mockResolvedValue(4);

        const response = await GET(request("metric=active-projects"));

        expect(response.status).toBe(200);
        expect(await responseBody(response)).toMatchObject({
            kind: "metric",
            key: "active-projects",
            scope: "project",
            value: 4,
            totalCount: 4,
        });
        const where = projectCount.mock.calls[0][0].where;
        const whereText = JSON.stringify(where);
        expect(whereText).toContain("Done");
        expect(whereText).toContain("Archived");
        expect(whereText).toContain("actor-1");
        expect(whereText).not.toContain("assigneeIds");
        expect(whereText).not.toContain("workspace-1");
        expect(projectFindMany).not.toHaveBeenCalled();

        for (const chip of [
            "assigneeIds=%40me",
            "priority=HIGH",
            "dueRange=today",
            "tagIds=tag-1",
            "workspaceId=workspace-1",
        ]) {
            const rejectedChipScope = await GET(request(`metric=active-projects&${chip}`));
            expect(rejectedChipScope.status, chip).toBe(400);
        }
        expect(projectCount).toHaveBeenCalledTimes(1);
    });

    it("uses department-authorized KPI reads with exact uppercase status groups", async () => {
        kpiCount.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
        kpiGroupBy.mockResolvedValueOnce([
            { status: "OFF_TRACK", _count: { _all: 1 } },
            { status: "ON_TRACK", _count: { _all: 2 } },
            { status: "AT_RISK", _count: { _all: 3 } },
        ]);

        const onTrack = await GET(request("metric=on-track-kpis"));
        const atRisk = await GET(request("metric=at-risk-kpis"));
        const statusChart = await GET(request("chartKind=kpi-status"));

        expect(onTrack.status).toBe(200);
        expect(atRisk.status).toBe(200);
        expect(statusChart.status).toBe(200);
        expect(await responseBody(onTrack)).toMatchObject({ value: 2, totalCount: 2, scope: "kpi" });
        expect(await responseBody(atRisk)).toMatchObject({ value: 3, totalCount: 3, scope: "kpi" });
        expect(await responseBody(statusChart)).toMatchObject({
            points: [
                { key: "ON_TRACK", label: "ON_TRACK", value: 2 },
                { key: "AT_RISK", label: "AT_RISK", value: 3 },
                { key: "OFF_TRACK", label: "OFF_TRACK", value: 1 },
            ],
            totalCount: 6,
        });
        expect(kpiCount.mock.calls[0][0]).toEqual({ where: { status: "ON_TRACK" } });
        expect(kpiCount.mock.calls[1][0]).toEqual({ where: { status: { in: ["AT_RISK", "OFF_TRACK"] } } });
        expect(kpiGroupBy.mock.calls[0][0]).toEqual({
            by: ["status"],
            where: {},
            _count: { _all: true },
        });
        expect(taskCount).not.toHaveBeenCalled();
        expect(taskGroupBy).not.toHaveBeenCalled();
    });

    it("returns 403 before any KPI delegate call when a non-admin has no department", async () => {
        toSabahActor.mockResolvedValue({ ...actor, departmentIds: [] });

        const response = await GET(request("metric=on-track-kpis"));

        expect(response.status).toBe(403);
        expect(await responseBody(response)).toEqual({ error: "Forbidden", code: "FORBIDDEN" });
        expect(kpiCount).not.toHaveBeenCalled();
        expect(kpiGroupBy).not.toHaveBeenCalled();
    });

    it("returns only the generic 500 payload when the aggregate delegate rejects", async () => {
        taskCount.mockRejectedValue(new Error("database connection secret"));
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await GET(request("metric=my-open"));

            expect(response.status).toBe(500);
            const body = await responseBody(response);
            expect(body).toEqual({ error: "Failed to fetch view aggregate" });
            expect(JSON.stringify(body)).not.toContain("database connection secret");
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });
});
