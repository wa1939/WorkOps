import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, type KpiStatus, type Priority, type TaskStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../../scripts/assert-local-database";
import { projectVisibilityWhere } from "@/lib/executive-summary";
import { buildTaskGridQuery } from "@/lib/tasks/grid-query";
import { normalizeViewTaskQuery } from "@/lib/view-task-query";

const explicitDatabaseUrl = Object.prototype.hasOwnProperty.call(process.env, "DATABASE_URL")
    ? process.env.DATABASE_URL
    : undefined;
const databaseUrl = readDatabaseUrl();
if (explicitDatabaseUrl === "") {
    assertLocalDatabaseUrl(explicitDatabaseUrl);
}
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("view aggregate PostgreSQL acceptance requires a database name ending with _test");
    }
}

const databaseEnabled = Boolean(databaseUrl);
const db = databaseEnabled ? new PrismaClient() : undefined;

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));

import { prisma as routePrisma } from "@/lib/prisma";
import { GET } from "./route";

type AggregatePoint = { key: string; label: string; value: number };
type AggregatePayload = {
    kind: "metric" | "chart";
    key: string;
    scope: string;
    value?: number;
    totalCount: number;
    points?: AggregatePoint[];
    timeZone: string;
    window?: { start: string; end: string };
};

const taskStatuses = ["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"] as const;
const priorities = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;
type FixtureTask = {
    id: string;
    status: (typeof taskStatuses)[number];
    priority: (typeof priorities)[number];
    projectId: string | null;
    workspaceId: string;
    dueAt: Date | null;
    doneAt: Date | null;
    tagId: string;
    createdById: string;
    isPrivate: boolean;
    archived: boolean;
};

function request(params: Record<string, string>): Request {
    const query = new URLSearchParams(params);
    return new Request(`http://localhost/api/views/aggregate?${query.toString()}`);
}

async function fetchAggregate(params: Record<string, string>): Promise<AggregatePayload> {
    const response = await GET(request(params));
    expect(response.status, JSON.stringify(params)).toBe(200);
    return await response.json() as AggregatePayload;
}

function withoutQueryParams(params: Record<string, string>, ...names: string[]): Record<string, string> {
    const alteredParams = { ...params };
    for (const name of names) delete alteredParams[name];
    return alteredParams;
}

function countBy<T extends string>(values: readonly T[]): Map<T, number> {
    const counts = new Map<T, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
}

function pointMap(points: readonly AggregatePoint[]): Map<string, number> {
    return new Map(points.map((point) => [point.key, point.value]));
}

function riyadhDateKey(date: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Riyadh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}

const suite = describe.runIf(databaseEnabled);

suite("GET /api/views/aggregate PostgreSQL acceptance", () => {
    beforeAll(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-07T22:30:00.000Z"));
    });

    afterAll(async () => {
        vi.useRealTimers();
        auth.mockReset();
        await db?.$disconnect();
        await routePrisma.$disconnect();
    });

    it("proves exact aggregate counts, privacy, date windows, KPI policy, and fixture cleanup", async () => {
        if (!db) throw new Error("database fixture was not initialized");

        const suffix = randomUUID();
        const actorId = `t27-actor-${suffix}`;
        const outsiderId = `t27-outsider-${suffix}`;
        const noAccessId = `t27-no-access-${suffix}`;
        const departmentId = `t27-department-${suffix}`;
        const workspaceAId = `t27-workspace-a-${suffix}`;
        const workspaceBId = `t27-workspace-b-${suffix}`;
        const projectAId = `t27-project-a-${suffix}`;
        const projectBId = `t27-project-b-${suffix}`;
        const projectDoneId = `t27-project-done-${suffix}`;
        const projectArchivedId = `t27-project-archived-${suffix}`;
        const outsideWorkspaceProjectId = `t27-outside-workspace-project-${suffix}`;
        const outsiderProjectId = `t27-outsider-project-${suffix}`;
        const releaseTagId = `t27-release-tag-${suffix}`;
        const otherTagId = `t27-other-tag-${suffix}`;
        const kpiIds = [
            `t27-kpi-on-track-${suffix}`,
            `t27-kpi-at-risk-${suffix}`,
            `t27-kpi-off-track-${suffix}`,
        ];

        const genericOpenIds = Array.from({ length: 132 }, (_, index) => (
            `t27-open-${suffix}-${String(index).padStart(3, "0")}`
        ));
        const specialOpenIds = [
            `t27-open-day-start-${suffix}`,
            `t27-open-day-inside-${suffix}`,
            `t27-open-before-day-${suffix}`,
            `t27-open-day-end-${suffix}`,
            `t27-open-week-end-${suffix}`,
        ];
        const doneIds = Array.from({ length: 13 }, (_, index) => (
            `t27-done-${suffix}-${String(index).padStart(2, "0")}`
        ));
        const privateTaskId = `t27-private-${suffix}`;
        const outsiderProjectTaskId = `t27-outsider-project-task-${suffix}`;
        const outsideWorkspaceTaskId = `t27-outside-workspace-${suffix}`;
        const taskIds = [...genericOpenIds, ...specialOpenIds, ...doneIds, privateTaskId, outsiderProjectTaskId, outsideWorkspaceTaskId];
        const projectIds = [projectAId, projectBId, projectDoneId, projectArchivedId, outsideWorkspaceProjectId, outsiderProjectId];
        const workspaceIds = [workspaceAId, workspaceBId];
        const userIds = [actorId, outsiderId, noAccessId];

        const weekStart = new Date("2026-10-03T21:00:00.000Z");
        const weekEnd = new Date("2026-10-10T21:00:00.000Z");
        const dayStart = new Date("2026-10-07T21:00:00.000Z");
        const dayEnd = new Date("2026-10-08T21:00:00.000Z");
        const openStatuses = ["TODO", "DOING", "BLOCKED", "WAITING"] as const;

        const genericOpenTasks: FixtureTask[] = genericOpenIds.map((id, index) => ({
            id,
            status: openStatuses[index % openStatuses.length],
            priority: priorities[index % priorities.length],
            projectId: [projectAId, projectBId, null, projectDoneId, projectArchivedId][index % 5],
            workspaceId: workspaceAId,
            dueAt: null,
            doneAt: null,
            tagId: index % 2 === 0 ? releaseTagId : otherTagId,
            createdById: actorId,
            isPrivate: false,
            archived: false,
        }));
        const specialOpenTasks: FixtureTask[] = [
            {
                id: specialOpenIds[0],
                status: "TODO",
                priority: "HIGH",
                projectId: projectAId,
                workspaceId: workspaceAId,
                dueAt: dayStart,
                doneAt: null,
                tagId: releaseTagId,
                createdById: actorId,
                isPrivate: false,
                archived: false,
            },
            {
                id: specialOpenIds[1],
                status: "DOING",
                priority: "URGENT",
                projectId: projectBId,
                workspaceId: workspaceAId,
                dueAt: new Date("2026-10-07T21:30:00.000Z"),
                doneAt: null,
                tagId: releaseTagId,
                createdById: actorId,
                isPrivate: false,
                archived: false,
            },
            {
                id: specialOpenIds[2],
                status: "BLOCKED",
                priority: "MEDIUM",
                projectId: null,
                workspaceId: workspaceAId,
                dueAt: new Date("2026-10-07T20:59:59.999Z"),
                doneAt: null,
                tagId: otherTagId,
                createdById: actorId,
                isPrivate: false,
                archived: false,
            },
            {
                id: specialOpenIds[3],
                status: "WAITING",
                priority: "LOW",
                projectId: projectDoneId,
                workspaceId: workspaceAId,
                dueAt: dayEnd,
                doneAt: null,
                tagId: otherTagId,
                createdById: actorId,
                isPrivate: false,
                archived: false,
            },
            {
                id: specialOpenIds[4],
                status: "TODO",
                priority: "HIGH",
                projectId: projectArchivedId,
                workspaceId: workspaceAId,
                dueAt: weekEnd,
                doneAt: null,
                tagId: releaseTagId,
                createdById: actorId,
                isPrivate: false,
                archived: false,
            },
        ];
        const doneTimes = [
            "2026-10-04T12:00:00.000Z",
            "2026-10-05T12:00:00.000Z",
            "2026-10-06T12:00:00.000Z",
            "2026-10-07T12:00:00.000Z",
            "2026-10-07T20:00:00.000Z",
            "2026-10-07T22:00:00.000Z",
            "2026-10-08T12:00:00.000Z",
            "2026-10-09T12:00:00.000Z",
            "2026-09-30T12:00:00.000Z",
            "2026-10-10T21:00:00.000Z",
            "2026-10-11T12:00:00.000Z",
            "2026-10-02T12:00:00.000Z",
            "2026-09-20T12:00:00.000Z",
        ];
        const doneTasks: FixtureTask[] = doneIds.map((id, index) => ({
            id,
            status: "DONE",
            priority: priorities[(index + 1) % priorities.length],
            projectId: [projectAId, projectBId, null, projectDoneId][index % 4],
            workspaceId: workspaceAId,
            dueAt: index === 2 ? new Date("2026-10-12T12:00:00.000Z") : null,
            doneAt: new Date(doneTimes[index]),
            tagId: index % 2 === 0 ? releaseTagId : otherTagId,
            createdById: actorId,
            isPrivate: false,
            archived: false,
        }));
        const authorizedTasks = [...genericOpenTasks, ...specialOpenTasks, ...doneTasks];
        const extraTasks: Array<FixtureTask & { createdById: string }> = [
            {
                id: privateTaskId,
                status: "TODO",
                priority: "HIGH",
                projectId: projectAId,
                workspaceId: workspaceAId,
                dueAt: null,
                doneAt: null,
                tagId: otherTagId,
                createdById: outsiderId,
                isPrivate: true,
                archived: false,
            },
            {
                id: outsiderProjectTaskId,
                status: "TODO",
                priority: "HIGH",
                projectId: outsiderProjectId,
                workspaceId: workspaceAId,
                dueAt: null,
                doneAt: null,
                tagId: otherTagId,
                createdById: actorId,
                isPrivate: false,
                archived: false,
            },
            {
                id: outsideWorkspaceTaskId,
                status: "TODO",
                priority: "HIGH",
                projectId: outsideWorkspaceProjectId,
                workspaceId: workspaceBId,
                dueAt: null,
                doneAt: null,
                tagId: otherTagId,
                createdById: actorId,
                isPrivate: false,
                archived: false,
            },
        ];

        const baselineKpiStatusRows = await db.kPI.groupBy({ by: ["status"], _count: { _all: true } });
        const baselineKpiPerspectiveRows = await db.kPI.groupBy({ by: ["perspective"], _count: { _all: true } });
        const baselineStatus = new Map(
            baselineKpiStatusRows.map((row) => [String(row.status), row._count._all]),
        );
        const baselineKpiPerspective = new Map(
            baselineKpiPerspectiveRows.map((row) => [String(row.perspective), row._count._all]),
        );
        let baselineTaskCount = 0;
        let baselineTaskStatus = new Map<string, number>();
        let baselineActiveProjects = 0;
        const fixtureKpiStatus: Array<{ id: string; status: KpiStatus; perspective: string }> = [
            { id: kpiIds[0], status: "ON_TRACK", perspective: `t27-perspective-one-${suffix}` },
            { id: kpiIds[1], status: "AT_RISK", perspective: `t27-perspective-two-${suffix}` },
            { id: kpiIds[2], status: "OFF_TRACK", perspective: `t27-perspective-two-${suffix}` },
        ];

        try {
            await db.workspace.createMany({
                data: [
                    { id: workspaceAId, slug: `t27-a-${suffix}`, name: `T27 Workspace A ${suffix}`, timezone: "Asia/Riyadh" },
                    { id: workspaceBId, slug: `t27-b-${suffix}`, name: `T27 Workspace B ${suffix}`, timezone: "Asia/Riyadh" },
                ],
            });
            await db.department.create({
                data: { id: departmentId, name: `T27 Department ${suffix}`, workspaceId: workspaceAId },
            });
            await db.user.createMany({
                data: [
                    { id: actorId, email: `${actorId}@example.test`, name: "T27 Actor", isActive: true },
                    { id: outsiderId, email: `${outsiderId}@example.test`, name: "T27 Outsider", isActive: true },
                    { id: noAccessId, email: `${noAccessId}@example.test`, name: "T27 No Access", isActive: true },
                ],
            });
            await db.userDepartment.create({ data: { userId: actorId, departmentId } });
            const baselineActor = { id: actorId, role: "MEMBER" as const, departmentIds: [departmentId] };
            const baselineInput = normalizeViewTaskQuery({}, actorId, new Date()).input;
            const baselineTaskWhere = buildTaskGridQuery(baselineInput, baselineActor).where;
            baselineTaskCount = await db.task.count({ where: baselineTaskWhere });
            const baselineTaskStatusRows = await db.task.groupBy({
                by: ["status"],
                where: baselineTaskWhere,
                _count: { _all: true },
            });
            baselineTaskStatus = new Map(
                baselineTaskStatusRows.map((row) => [String(row.status), row._count._all]),
            );
            baselineActiveProjects = await db.project.count({
                where: {
                    AND: [
                        projectVisibilityWhere(baselineActor) as Prisma.ProjectWhereInput,
                        { status: { notIn: ["Done", "Archived"] } },
                    ],
                },
            });
            await db.workspaceMember.createMany({
                data: [
                    { workspaceId: workspaceAId, userId: actorId },
                    { workspaceId: workspaceBId, userId: outsiderId },
                ],
            });
            await db.project.createMany({
                data: [
                    { id: projectAId, name: "Same name", status: "Active", workspaceId: workspaceAId, ownerId: actorId },
                    { id: projectBId, name: "Same name", status: "Active", workspaceId: workspaceAId, ownerId: actorId },
                    { id: projectDoneId, name: `T27 Done ${suffix}`, status: "Done", workspaceId: workspaceAId, ownerId: actorId },
                    { id: projectArchivedId, name: `T27 Archived ${suffix}`, status: "Archived", workspaceId: workspaceAId, ownerId: actorId },
                    { id: outsideWorkspaceProjectId, name: `T27 Outside Workspace ${suffix}`, status: "Done", workspaceId: workspaceBId, ownerId: actorId },
                    { id: outsiderProjectId, name: `T27 Outsider ${suffix}`, status: "Active", workspaceId: workspaceBId, ownerId: outsiderId },
                ],
            });
            await db.tag.createMany({
                data: [
                    { id: releaseTagId, name: `t27-release-${suffix}`, color: "#111111" },
                    { id: otherTagId, name: `t27-other-${suffix}`, color: "#222222" },
                ],
            });
            await db.kPI.createMany({
                data: fixtureKpiStatus.map(({ id, status, perspective }) => ({
                    id,
                    perspective,
                    objective: `T27 objective ${id}`,
                    name: `T27 KPI ${id}`,
                    workspaceId: workspaceAId,
                    status,
                })),
            });
            await db.task.createMany({
                data: [...authorizedTasks, ...extraTasks].map((task) => ({
                    id: task.id,
                    taskKey: task.id,
                    title: `T27 task ${task.id}`,
                    status: task.status as TaskStatus,
                    priority: task.priority as Priority,
                    projectId: task.projectId,
                    workspaceId: task.workspaceId,
                    dueAt: task.dueAt,
                    doneAt: task.doneAt,
                    createdById: task.createdById,
                    isPrivate: task.isPrivate,
                    archived: task.archived,
                } satisfies Prisma.TaskCreateManyInput)),
            });
            await db.taskAssignment.createMany({
                data: [...genericOpenTasks, ...specialOpenTasks].map((task) => ({ taskId: task.id, userId: actorId })),
            });
            await db.taskTag.createMany({
                data: authorizedTasks.map((task) => ({
                    id: `t27-task-tag-${task.id}`,
                    taskId: task.id,
                    tagId: task.tagId,
                })),
            });

            auth.mockResolvedValue({ user: { id: actorId, role: "ADMIN", departmentIds: [] } });
            const taskScope = (params: Record<string, string>) => ({ search: suffix, workspaceId: workspaceAId, ...params });

            const myOpen = await fetchAggregate({ metric: "my-open" });
            expect(myOpen).toMatchObject({ kind: "metric", key: "my-open", value: 137, totalCount: 137, scope: "task" });

            const unscopedByStatus = await fetchAggregate({ chartKind: "task-by-status" });
            const unscopedFixtureTasks = [...authorizedTasks, extraTasks[2]];
            const expectedUnscopedStatuses = new Map(baselineTaskStatus);
            const expectedStatuses = countBy(authorizedTasks.map((task) => task.status));
            const expectedUnscopedStatusCounts = countBy(unscopedFixtureTasks.map((task) => task.status));
            expectedUnscopedStatusCounts.forEach((value, status) => {
                expectedUnscopedStatuses.set(status, (expectedUnscopedStatuses.get(status) ?? 0) + value);
            });
            expect(unscopedByStatus.totalCount).toBe(baselineTaskCount + unscopedFixtureTasks.length);
            expect(pointMap(unscopedByStatus.points ?? [])).toEqual(expectedUnscopedStatuses);

            const byStatus = await fetchAggregate(taskScope({ chartKind: "task-by-status" }));
            expect(byStatus.totalCount).toBe(authorizedTasks.length);
            expect(pointMap(byStatus.points ?? [])).toEqual(new Map(
                Array.from(expectedStatuses, ([key, value]) => [key, value]),
            ));
            expect((byStatus.points ?? []).reduce((sum, point) => sum + point.value, 0)).toBe(authorizedTasks.length);

            const byPriority = await fetchAggregate(taskScope({ chartKind: "task-by-priority" }));
            const expectedPriorities = countBy(authorizedTasks.map((task) => task.priority));
            expect(pointMap(byPriority.points ?? [])).toEqual(new Map(
                Array.from(expectedPriorities, ([key, value]) => [key, value]),
            ));
            expect((byPriority.points ?? []).reduce((sum, point) => sum + point.value, 0)).toBe(authorizedTasks.length);

            const byProject = await fetchAggregate(taskScope({ chartKind: "task-by-project" }));
            const expectedProjects = countBy(authorizedTasks.map((task) => task.projectId ?? "__no-project__"));
            const projectPoints = pointMap(byProject.points ?? []);
            expect(projectPoints).toEqual(new Map(Array.from(expectedProjects, ([key, value]) => [key, value])));
            expect((byProject.points ?? []).some((point) => point.key === projectAId && point.label === "Same name")).toBe(true);
            expect((byProject.points ?? []).some((point) => point.key === projectBId && point.label === "Same name")).toBe(true);
            expect((byProject.points ?? []).some((point) => point.key === outsiderProjectId || point.label === `T27 Outsider ${suffix}`)).toBe(false);
            expect((byProject.points ?? []).find((point) => point.key === "__no-project__")).toMatchObject({ label: "No project" });

            const workspaceScoped = await fetchAggregate(taskScope({ metric: "my-open", workspaceId: workspaceAId }));
            expect(workspaceScoped.value).toBe(137);
            const outsideWorkspace = await fetchAggregate(taskScope({ metric: "my-open", workspaceId: workspaceBId }));
            expect(outsideWorkspace.value).toBe(0);

            const matchingProject = await fetchAggregate(taskScope({ metric: "my-open", projectId: projectAId, projectIds: `${projectAId},${projectBId}` }));
            expect(matchingProject.value).toBe(genericOpenTasks.filter((task) => task.projectId === projectAId).length + 1);
            const conflictingProjects = await fetchAggregate(taskScope({ metric: "my-open", projectId: projectAId, projectIds: projectBId }));
            expect(conflictingProjects.value).toBe(0);

            const matchingProjectTasks = authorizedTasks.filter((task) => task.projectId === projectAId);
            const expectedMatchingProjectPoints = new Map(
                Array.from(countBy(matchingProjectTasks.map((task) => task.projectId ?? "__no-project__")), ([key, value]) => [key, value]),
            );
            const matchingProjectChart = await fetchAggregate(taskScope({
                chartKind: "task-by-project",
                projectId: projectAId,
                projectIds: `${projectAId},${projectBId}`,
            }));
            expect(matchingProjectChart.totalCount).toBe(matchingProjectTasks.length);
            expect(pointMap(matchingProjectChart.points ?? [])).toEqual(expectedMatchingProjectPoints);

            const conflictingProjectChart = await fetchAggregate(taskScope({
                chartKind: "task-by-project",
                projectId: projectAId,
                projectIds: projectBId,
            }));
            expect(conflictingProjectChart.totalCount).toBe(0);
            expect(conflictingProjectChart.points).toEqual([]);

            const releaseOpenExpected = [...genericOpenTasks, ...specialOpenTasks]
                .filter((task) => task.tagId === releaseTagId).length;
            const releaseOpen = await fetchAggregate(taskScope({ metric: "my-open", tagIds: releaseTagId }));
            expect(releaseOpen.value).toBe(releaseOpenExpected);
            const releaseTasks = authorizedTasks.filter((task) => task.tagId === releaseTagId);
            const expectedReleaseStatusPoints = new Map(
                Array.from(countBy(releaseTasks.map((task) => task.status)), ([key, value]) => [key, value]),
            );
            const releaseStatus = await fetchAggregate(taskScope({ chartKind: "task-by-status", tagIds: releaseTagId }));
            expect(releaseStatus.totalCount).toBe(releaseTasks.length);
            expect(pointMap(releaseStatus.points ?? [])).toEqual(expectedReleaseStatusPoints);

            // Test-only negative control: dropping the tag query must differ from the exact tagged fixture map.
            const droppedTagFilter = await fetchAggregate(withoutQueryParams(
                taskScope({ chartKind: "task-by-status", tagIds: releaseTagId }),
                "tagIds",
            ));
            expect(droppedTagFilter.totalCount).toBe(byStatus.totalCount);
            expect(pointMap(droppedTagFilter.points ?? [])).toEqual(pointMap(byStatus.points ?? []));
            expect(droppedTagFilter.totalCount).not.toBe(releaseTasks.length);
            expect(pointMap(droppedTagFilter.points ?? [])).not.toEqual(expectedReleaseStatusPoints);

            const dueToday = await fetchAggregate(taskScope({ metric: "my-open", dueRange: "today" }));
            expect(dueToday.value).toBe(2);
            const dueIntersection = await fetchAggregate(taskScope({
                metric: "my-open",
                dueRange: "today",
                dueAfter: "2026-10-07T21:30:00.000Z",
                dueBefore: "2026-10-07T22:00:00.000Z",
            }));
            expect(dueIntersection.value).toBe(1);

            const doneThisWeek = await fetchAggregate(taskScope({ metric: "team-done-week" }));
            const expectedDoneThisWeek = doneTasks.filter((task) => task.doneAt && task.doneAt >= weekStart && task.doneAt < weekEnd).length;
            expect(doneThisWeek).toMatchObject({ value: expectedDoneThisWeek, totalCount: expectedDoneThisWeek });
            expect(expectedDoneThisWeek).toBe(8);

            const trend = await fetchAggregate(taskScope({ chartKind: "task-completion-trend" }));
            const firstTrendDay = new Date(dayStart.getTime() - 13 * 24 * 60 * 60 * 1000);
            const expectedTrend = Array.from({ length: 14 }, (_, index) => {
                const start = new Date(firstTrendDay.getTime() + index * 24 * 60 * 60 * 1000);
                const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
                return {
                    key: riyadhDateKey(start),
                    label: riyadhDateKey(start),
                    value: doneTasks.filter((task) => task.doneAt && task.doneAt >= start && task.doneAt < end).length,
                };
            });
            expect(trend.points).toEqual(expectedTrend);
            expect(trend.points).toHaveLength(14);
            expect(trend.totalCount).toBe(expectedTrend.reduce((sum, point) => sum + point.value, 0));
            expect(trend.window).toEqual({
                start: firstTrendDay.toISOString(),
                end: dayEnd.toISOString(),
            });

            const activeProjects = await fetchAggregate({ metric: "active-projects" });
            expect(activeProjects).toMatchObject({
                kind: "metric",
                key: "active-projects",
                scope: "project",
                value: baselineActiveProjects + 2,
                totalCount: baselineActiveProjects + 2,
            });

            const onTrack = await fetchAggregate({ metric: "on-track-kpis" });
            const atRisk = await fetchAggregate({ metric: "at-risk-kpis" });
            expect(onTrack.value).toBe((baselineStatus.get("ON_TRACK") ?? 0) + 1);
            expect(atRisk.value).toBe(
                (baselineStatus.get("AT_RISK") ?? 0)
                + (baselineStatus.get("OFF_TRACK") ?? 0)
                + 2,
            );
            const kpiStatus = await fetchAggregate({ chartKind: "kpi-status" });
            const kpiStatusPoints = pointMap(kpiStatus.points ?? []);
            for (const status of ["ON_TRACK", "AT_RISK", "OFF_TRACK"]) {
                const fixtureDelta = fixtureKpiStatus.filter((kpi) => kpi.status === status).length;
                expect(kpiStatusPoints.get(status)).toBe((baselineStatus.get(status) ?? 0) + fixtureDelta);
            }
            expect(kpiStatusPoints.has("on_track")).toBe(false);
            expect(kpiStatusPoints.has("at_risk")).toBe(false);
            expect(kpiStatusPoints.has("off_track")).toBe(false);

            const kpiPerspective = await fetchAggregate({ chartKind: "kpi-by-perspective" });
            const kpiPerspectivePoints = pointMap(kpiPerspective.points ?? []);
            Array.from(new Set(fixtureKpiStatus.map((kpi) => kpi.perspective))).forEach((perspective) => {
                const fixtureDelta = fixtureKpiStatus.filter((kpi) => kpi.perspective === perspective).length;
                expect(kpiPerspectivePoints.get(perspective)).toBe((baselineKpiPerspective.get(perspective) ?? 0) + fixtureDelta);
            });

            auth.mockResolvedValue({ user: { id: noAccessId, role: "ADMIN", departmentIds: ["not-authoritative"] } });
            const forbiddenKpi = await GET(request({ metric: "on-track-kpis" }));
            expect(forbiddenKpi.status).toBe(403);
            expect(await forbiddenKpi.json()).toEqual({ error: "Forbidden", code: "FORBIDDEN" });
        } finally {
            await db.taskTag.deleteMany({ where: { taskId: { in: taskIds } } });
            await db.taskAssignment.deleteMany({ where: { taskId: { in: taskIds } } });
            await db.task.deleteMany({ where: { id: { in: taskIds } } });
            await db.project.deleteMany({ where: { id: { in: projectIds } } });
            await db.kPI.deleteMany({ where: { id: { in: kpiIds } } });
            await db.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
            await db.userDepartment.deleteMany({ where: { userId: { in: userIds } } });
            await db.tag.deleteMany({ where: { id: { in: [releaseTagId, otherTagId] } } });
            await db.department.deleteMany({ where: { id: departmentId } });
            await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
            await db.user.deleteMany({ where: { id: { in: userIds } } });

            expect(await db.task.count({ where: { id: { in: taskIds } } })).toBe(0);
            expect(await db.project.count({ where: { id: { in: projectIds } } })).toBe(0);
            expect(await db.kPI.count({ where: { id: { in: kpiIds } } })).toBe(0);
            expect(await db.workspace.count({ where: { id: { in: workspaceIds } } })).toBe(0);
            expect(await db.user.count({ where: { id: { in: userIds } } })).toBe(0);
            expect(await db.department.count({ where: { id: departmentId } })).toBe(0);
            expect(await db.tag.count({ where: { id: { in: [releaseTagId, otherTagId] } } })).toBe(0);
        }
    });
});
