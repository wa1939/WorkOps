import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, findMany, count } = vi.hoisted(() => ({
    auth: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/prisma", () => ({
    prisma: { task: { findMany, count } },
}));

import { GET } from "./route";

type ViewDataPayload = {
    rows: Array<{ id: string; dueAt: string | null; dueDate: string | null }>;
    totalCount: number;
    nextOffset: number | null;
};

function row(id: string, dueAt: Date | null = null) {
    return {
        id,
        taskKey: id,
        title: id,
        status: "TODO",
        priority: "MEDIUM",
        dueAt,
        estimateMinutes: null,
        updatedAt: new Date("2026-10-01T00:00:00.000Z"),
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        assignments: [],
        project: null,
        workspace: null,
        tags: [],
    };
}

function request(query = "") {
    return new Request(`http://localhost/api/tasks/view-data${query ? `?${query}` : ""}`);
}

describe("GET /api/tasks/view-data", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.mockResolvedValue({ user: { id: "actor-1", role: "MEMBER", departmentIds: [] } });
        count.mockResolvedValue(0);
        findMany.mockResolvedValue([]);
    });

    it("returns 401 before parsing or querying without an authenticated actor", async () => {
        auth.mockResolvedValue(null);

        const response = await GET(request("sortBy=not-allowed"));

        expect(response.status).toBe(401);
        expect(findMany).not.toHaveBeenCalled();
        expect(count).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid list, date, sort, and offset query values", async () => {
        const invalidQueries = [
            "status=NOT_A_STATUS",
            "dueRange=tomorrow",
            "dueRange=overdue&dueAfter=2099-01-01T00:00:00.000Z",
            "sortBy=drop-table",
            "groupBy=workspace",
            "offset=-1",
            "offset=1.5",
            "offset=10001",
            "projectIds=,",
            "projectIds=project-1,",
            "projectIds=,project-1",
            `tagIds=${Array.from({ length: 101 }, (_, index) => `tag-${index}`).join(",")}`,
        ];

        for (const query of invalidQueries) {
            const response = await GET(request(query));
            expect(response.status, query).toBe(400);
        }

        expect(findMany).not.toHaveBeenCalled();
        expect(count).not.toHaveBeenCalled();
    });

    it("uses one authorized where clause for the exact count and page query", async () => {
        const pageRows = Array.from({ length: 51 }, (_, index) => row(`task-${index}`, index === 0 ? new Date("2026-10-08T00:00:00.000Z") : null));
        count.mockResolvedValue(101);
        findMany.mockResolvedValue(pageRows);

        const response = await GET(request(
            "workspaceId=workspace-1"
            + "&status=TODO&status=BLOCKED"
            + "&assigneeIds=%40me&tagIds=tag-1,tag-2"
            + "&projectId=project-1&projectIds=project-1,project-2"
            + "&dueRange=today&sortBy=dueAt&dir=asc&groupBy=project&offset=50",
        ));

        expect(response.status).toBe(200);
        const payload = await response.json() as ViewDataPayload;
        expect(payload.totalCount).toBe(101);
        expect(payload.rows).toHaveLength(50);
        expect(payload.rows[0]).toMatchObject({
            id: "task-0",
            dueDate: "2026-10-08T00:00:00.000Z",
        });
        expect(payload.nextOffset).toBe(100);

        expect(findMany).toHaveBeenCalledTimes(1);
        expect(count).toHaveBeenCalledTimes(1);
        const pageArgs = findMany.mock.calls[0][0] as {
            where: Record<string, unknown>;
            orderBy: unknown;
            skip: number;
            take: number;
        };
        const countArgs = count.mock.calls[0][0] as { where: Record<string, unknown> };
        expect(countArgs.where).toEqual(pageArgs.where);
        expect(pageArgs.skip).toBe(50);
        expect(pageArgs.take).toBe(51);
        expect(pageArgs.orderBy).toEqual([{ dueAt: "asc" }, { id: "asc" }]);

        const whereText = JSON.stringify(pageArgs.where);
        expect(whereText).toContain("actor-1");
        expect(whereText).toContain("workspace-1");
        expect(whereText).toContain("project-1");
        expect(whereText).toContain("project-2");
        expect(whereText).toContain("tag-1");
        expect(whereText).toContain("tag-2");
        expect(whereText).toContain("DONE");
        expect(whereText).toContain("CANCELED");
    });

    it.each([
        [9950, 51, 10000],
        [10000, 51, null],
        [9999, 51, null],
        [10000, 50, null],
    ] as const)("caps continuation at an accepted offset for page %s", async (offset, size, nextOffset) => {
        count.mockResolvedValue(20000);
        findMany.mockResolvedValue(Array.from({ length: size }, (_, index) => row(`task-${index}`)));

        const response = await GET(request(`offset=${offset}`));
        expect(response.status).toBe(200);
        const payload = await response.json() as ViewDataPayload;
        expect(payload.nextOffset).toBe(nextOffset);
        expect(payload.totalCount).toBe(20000);
        expect(payload.rows).toHaveLength(50);
    });

    it("passes explicit due bounds from the URL parser into the authorized where clause", async () => {
        const response = await GET(request(
            "dueAfter=2026-10-01T00:00:00.000Z&dueBefore=2026-10-10T00:00:00.000Z",
        ));

        expect(response.status).toBe(200);
        const pageArgs = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
        const whereText = JSON.stringify(pageArgs.where);
        expect(whereText).toContain("2026-10-01T00:00:00.000Z");
        expect(whereText).toContain("2026-10-10T00:00:00.000Z");
    });

    it("walks static sorted pages without gaps or duplicate ids and stops at the remainder", async () => {
        count.mockResolvedValue(101);
        findMany.mockImplementation(({ skip }: { skip: number }) => {
            if (skip === 0) return Promise.resolve(Array.from({ length: 51 }, (_, index) => row(`task-${index}`)));
            if (skip === 50) return Promise.resolve(Array.from({ length: 51 }, (_, index) => row(`task-${index + 50}`)));
            return Promise.resolve([row("task-100")]);
        });

        const pages: ViewDataPayload[] = [];
        for (const offset of [0, 50, 100]) {
            const response = await GET(request(`sortBy=priority&dir=desc&offset=${offset}`));
            expect(response.status).toBe(200);
            pages.push(await response.json() as ViewDataPayload);
        }

        expect(pages.map((page) => page.rows.length)).toEqual([50, 50, 1]);
        expect(pages.map((page) => page.nextOffset)).toEqual([50, 100, null]);
        const ids = pages.flatMap((page) => page.rows.map((item) => item.id));
        expect(ids).toHaveLength(101);
        expect(new Set(ids).size).toBe(101);
        expect(ids).toEqual(Array.from({ length: 101 }, (_, index) => `task-${index}`));
    });

    it("emits null due dates and stable ID tie-breakers for every supported sort direction", async () => {
        findMany.mockResolvedValue([row("null-due"), row("dated", new Date("2026-10-08T00:00:00.000Z"))]);
        const cases = [
            ["dueDate", "asc", [{ dueAt: "asc" }, { id: "asc" }]],
            ["dueDate", "desc", [{ dueAt: "desc" }, { id: "desc" }]],
            ["priority", "asc", [{ priority: "asc" }, { id: "asc" }]],
            ["priority", "desc", [{ priority: "desc" }, { id: "desc" }]],
        ] as const;

        for (const [sortBy, dir, orderBy] of cases) {
            const response = await GET(request(`sortBy=${sortBy}&dir=${dir}`));
            expect(response.status).toBe(200);
            const payload = await response.json() as ViewDataPayload;
            expect(payload.rows[0].dueDate).toBeNull();
            const calls = findMany.mock.calls;
            expect(calls[calls.length - 1][0].orderBy).toEqual(orderBy);
        }
    });

    it("does not leak database errors through the generic 500 response", async () => {
        count.mockResolvedValue(0);
        findMany.mockRejectedValue(new Error("database connection secret"));
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await GET(request());

            expect(response.status).toBe(500);
            expect(await response.json()).toEqual({ error: "Failed to fetch view task data" });
        } finally {
            errorSpy.mockRestore();
        }
    });
});
