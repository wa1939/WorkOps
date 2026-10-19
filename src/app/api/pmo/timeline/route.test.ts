import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const toSabahActor = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));
vi.mock("@/lib/sabah/auth/actor", () => ({
    toSabahActor: (...args: unknown[]) => toSabahActor(...args),
    SabahForbiddenError: class SabahForbiddenError extends Error {},
}));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findMany: (...args: unknown[]) => findMany(...args) } } }));

import { GET } from "./route";

describe("GET /api/pmo/timeline", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.mockResolvedValue({ user: { id: "member-1" } });
        toSabahActor.mockResolvedValue({ id: "member-1", role: "MEMBER", departmentIds: ["dept-1"] });
    });

    it("rejects unauthenticated requests", async () => {
        auth.mockResolvedValue(null);

        const response = await GET();

        expect(response.status).toBe(401);
        expect(findMany).not.toHaveBeenCalled();
    });

    it("rejects viewers while allowing member-level portfolio access", async () => {
        toSabahActor.mockResolvedValue({ id: "viewer-1", role: "VIEWER", departmentIds: [] });

        const response = await GET();

        expect(response.status).toBe(403);
        expect(findMany).not.toHaveBeenCalled();
    });

    it("returns visible projects, progress aggregates, and date bounds", async () => {
        findMany.mockResolvedValue([
            {
                id: "project-1",
                name: "Launch",
                status: "Active",
                health: "AT_RISK",
                startAt: new Date("2026-01-05T00:00:00.000Z"),
                dueAt: new Date("2026-02-10T00:00:00.000Z"),
                dueAtEnd: null,
                updatedAt: new Date("2026-01-02T00:00:00.000Z"),
                stages: [{ status: "COMPLETE" }, { status: "ACTIVE" }, { status: "PLANNED" }],
                tasks: [{ status: "DONE" }, { status: "DOING" }, { status: "TODO" }],
            },
            {
                id: "project-2",
                name: "Unscheduled",
                status: "Planning",
                health: "NOT_SET",
                startAt: null,
                dueAt: null,
                dueAtEnd: null,
                updatedAt: new Date("2026-01-03T00:00:00.000Z"),
                stages: [],
                tasks: [],
            },
        ]);

        const response = await GET();
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            orderBy: { name: "asc" },
            where: expect.objectContaining({ OR: expect.any(Array) }),
        }));
        expect(body).toMatchObject({
            minDate: "2026-01-05T00:00:00.000Z",
            maxDate: "2026-02-10T00:00:00.000Z",
            projects: [
                {
                    id: "project-1",
                    status: "Active",
                    health: "AT_RISK",
                    stageProgress: {
                        total: 3,
                        complete: 1,
                        active: 1,
                        planned: 1,
                        blocked: 0,
                        completed: 1,
                        percent: 33,
                    },
                    taskProgress: { total: 3, done: 1, percent: 33 },
                },
                { id: "project-2", startAt: null, dueAt: null },
            ],
        });
    });
});
