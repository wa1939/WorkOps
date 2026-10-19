import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    authorize: vi.fn(),
    resolveOperationalAiTarget: vi.fn(),
    requestTaskBreakdown: vi.fn(),
    requestQuickAdd: vi.fn(),
    requestTaskSummary: vi.fn(),
    requestTitleImprovement: vi.fn(),
    getTaskForActor: vi.fn(),
    createTask: vi.fn(),
    findMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", () => ({ authorize: mocks.authorize }));
vi.mock("@/lib/ai/provider-resolution", () => ({ resolveOperationalAiTarget: mocks.resolveOperationalAiTarget }));
vi.mock("@/lib/ai/task-actions", () => ({
    AI_RESPONSE_ERROR: "Sabah could not produce a usable response",
    requestTaskBreakdown: mocks.requestTaskBreakdown,
    requestQuickAdd: mocks.requestQuickAdd,
    requestTaskSummary: mocks.requestTaskSummary,
    requestTitleImprovement: mocks.requestTitleImprovement,
}));
vi.mock("@/lib/tasks/authorization", () => ({
    taskScopeForActor: vi.fn(() => ({})),
}));
vi.mock("@/lib/tasks/commands", () => ({
    createTask: mocks.createTask,
    getTaskForActor: mocks.getTaskForActor,
    TaskCommandError: class TaskCommandError extends Error {
        status = 500;
    },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { task: { findMany: mocks.findMany } } }));

import { POST } from "./route";

function request(body: unknown): Request {
    return new Request("http://localhost/api/ai/task-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

const parentTask = {
    id: "task-1",
    title: "Prepare the launch brief",
    description: "Align scope, draft the brief, and get review.",
    projectId: "project-1",
    workspaceId: "workspace-1",
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "actor-1", role: "MEMBER" } });
    mocks.authorize.mockResolvedValue(true);
    mocks.resolveOperationalAiTarget.mockResolvedValue({
        provider: "glm",
        model: "glm-4.5",
        fallbacks: [],
        credentials: {},
    });
    mocks.getTaskForActor.mockResolvedValue(parentTask);
});

describe("task action preview boundaries", () => {
    it.each([
        { action: "summarize", tasks: ["task-1"] },
        { action: "breakdown-preview", taskId: "task-1" },
        { action: "breakdown", taskId: "task-1" },
        { action: "improve-title", taskId: "task-1" },
        { action: "parse-preview", text: "Prepare the brief" },
        { action: "parse-add", text: "Prepare the brief" },
    ])("returns a typed JSON error for invalid AI output from $action", async (body) => {
        mocks.findMany.mockResolvedValue([{ id: "task-1", title: parentTask.title, status: "TODO", dueAt: null }]);
        mocks.requestTaskSummary.mockResolvedValue(null);
        mocks.requestTaskBreakdown.mockResolvedValue(null);
        mocks.requestTitleImprovement.mockResolvedValue(null);
        mocks.requestQuickAdd.mockResolvedValue(null);

        const response = await POST(request(body));

        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: "Sabah could not produce a usable response" });
        expect(mocks.createTask).not.toHaveBeenCalled();
    });

    it("passes the validated summary purpose to the existing summary service", async () => {
        mocks.findMany.mockResolvedValue([{ id: "task-1", title: parentTask.title, status: "DOING", dueAt: null }]);
        mocks.requestTaskSummary.mockResolvedValue({
            summary: "• Start with the brief\n• Resolve the blocker\n• Send the next update",
            facts: { scope: "selected_sample", selectedCount: 1, statusCounts: { DOING: 1 } },
        });

        const response = await POST(request({
            action: "summarize",
            tasks: ["task-1"],
            summaryMode: "plan",
            context: { surface: "sabah-daily-dashboard", mode: "plan" },
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            summary: "• Start with the brief\n• Resolve the blocker\n• Send the next update",
            facts: { scope: "selected_sample", selectedCount: 1, statusCounts: { DOING: 1 } },
            sourceSnapshot: [{ id: "task-1", title: parentTask.title, status: "DOING", dueAt: null }],
        });
        expect(mocks.requestTaskSummary).toHaveBeenCalledWith(
            [{ id: "task-1", title: parentTask.title, status: "DOING", dueAt: null }],
            expect.objectContaining({ provider: "glm" }),
            { surface: "sabah-daily-dashboard", mode: "plan" },
            "plan",
        );
    });

    it("returns breakdown suggestions without creating tasks", async () => {
        const suggestions = [
            { title: "Confirm the launch scope", estimateMinutes: 30 },
            { title: "Draft the first version", estimateMinutes: 90 },
        ];
        mocks.requestTaskBreakdown.mockResolvedValue(suggestions);

        const response = await POST(request({
            action: "breakdown-preview",
            taskId: "task-1",
            context: { surface: "sabah-daily-dashboard" },
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            suggestions,
            sourceSnapshot: [{
                id: parentTask.id,
                title: parentTask.title,
                status: "TODO",
                dueAt: null,
                priority: "MEDIUM",
                description: parentTask.description,
                projectId: parentTask.projectId,
            }],
        });
        expect(mocks.createTask).not.toHaveBeenCalled();
        expect(mocks.requestTaskBreakdown).toHaveBeenCalledWith(
            { title: parentTask.title, description: parentTask.description },
            expect.objectContaining({ provider: "glm" }),
            { surface: "sabah-daily-dashboard" },
        );
    });

    it("returns a note capture proposal without creating a task", async () => {
        const suggestion = { title: "Schedule stakeholder review", priority: "HIGH", estimateMinutes: 45, dueInDays: 3 };
        mocks.requestQuickAdd.mockResolvedValue(suggestion);

        const response = await POST(request({
            action: "parse-preview",
            text: "Schedule stakeholder review in three days",
            context: { surface: "sabah-daily-dashboard" },
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ suggestion });
        expect(mocks.createTask).not.toHaveBeenCalled();
        expect(mocks.requestQuickAdd).toHaveBeenCalledWith(
            "Schedule stakeholder review in three days",
            expect.objectContaining({ provider: "glm" }),
            { surface: "sabah-daily-dashboard" },
        );
    });

    it("keeps the legacy breakdown action as the explicitly mutating path", async () => {
        mocks.requestTaskBreakdown.mockResolvedValue([{ title: "Draft the first version", estimateMinutes: 60 }]);
        mocks.createTask.mockResolvedValue({ id: "created-1", title: "Draft the first version" });

        const response = await POST(request({ action: "breakdown", taskId: "task-1" }));

        expect(response.status).toBe(201);
        expect(mocks.createTask).toHaveBeenCalledTimes(1);
    });
});
