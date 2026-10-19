// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../sabah/test/setup";
import { SabahDailyDashboard } from "./sabah-daily-dashboard";

const sabah = vi.hoisted(() => ({
    activeHost: { id: "sabah-assistant-1", element: {} as HTMLElement, visible: false },
    dispatch: vi.fn(),
    setHostVisibility: vi.fn(),
}));

vi.mock("@/components/sabah/sabah-host", () => ({
    SabahWorkspaceHost: ({ hostId, className }: { hostId: string; className?: string }) => (
        <div data-testid={`host-${hostId}`} className={className} />
    ),
}));
vi.mock("@/components/sabah/state/sabah-context", () => ({
    useSabahMaybe: () => sabah,
}));

const rows = [
    {
        id: "task-1",
        title: "Prepare the launch brief",
        status: "DOING",
        priority: "HIGH",
        dueAt: "2026-10-16T16:00:00.000Z",
        project: { id: "project-1", name: "Launch" },
        assignments: [],
    },
    {
        id: "task-2",
        title: "Resolve the review blocker",
        status: "BLOCKED",
        priority: "URGENT",
        dueAt: null,
        project: null,
        assignments: [],
    },
];

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
let malformedOpenMetric = false;
let malformedTaskResponse = false;
let summarySourceTitle: string | null = null;
let malformedSummarySnapshot = false;
let captureDueInDays = 3;
let holdSummaryResponse = false;
let resolveSummaryResponse: ((response: Response) => void) | null = null;
let holdWorkflowRecovery = false;
let resolveWorkflowRecovery: ((response: Response) => void) | null = null;
let workflowRecoveryResponse: unknown | null = null;

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
    vi.clearAllMocks();
    fetchMock.mockReset();
    malformedOpenMetric = false;
    malformedTaskResponse = false;
    summarySourceTitle = null;
    malformedSummarySnapshot = false;
    captureDueInDays = 3;
    holdSummaryResponse = false;
    resolveSummaryResponse = null;
    holdWorkflowRecovery = false;
    resolveWorkflowRecovery = null;
    workflowRecoveryResponse = null;
    window.localStorage.clear();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async (input, init) => {
        const url = String(input);
        if (init?.method === "POST" && url.includes("/api/ai/task-actions")) {
            const body = JSON.parse(String(init.body));
            if (body.action === "summarize") {
                const sourceSnapshot = body.tasks.map((id: string) => {
                    const task = rows.find((candidate) => candidate.id === id);
                    return { id, title: id === "task-1" && summarySourceTitle ? summarySourceTitle : task?.title ?? id, status: task?.status ?? "TODO", dueAt: task?.dueAt ?? null };
                });
                const statusCounts = Object.fromEntries(sourceSnapshot.map((task: { status: string }) => task.status).reduce((counts: Map<string, number>, status: string) => counts.set(status, (counts.get(status) ?? 0) + 1), new Map<string, number>()));
                const response = json(malformedSummarySnapshot
                    ? { summary: "• Invalid\n• Stale\n• Evidence", sourceSnapshot: [] }
                    : { summary: "• Resolve the blocker first\n• Keep the launch brief moving\n• Keep the next decision visible", facts: { scope: "selected_sample", selectedCount: sourceSnapshot.length, statusCounts }, sourceSnapshot });
                if (holdSummaryResponse) return new Promise<Response>((resolve) => { resolveSummaryResponse = resolve; });
                return response;
            }
            if (body.action === "breakdown-preview") return json({ suggestions: [
                { title: "Confirm the launch scope", estimateMinutes: 30 },
                { title: "Draft the first version", estimateMinutes: 90 },
            ], sourceSnapshot: [{ id: "task-1", title: rows[0].title, status: rows[0].status, dueAt: rows[0].dueAt, description: "Launch brief", projectId: "project-1" }] });
            if (body.action === "parse-preview") return json({ suggestion: {
                title: "Schedule stakeholder review",
                priority: "HIGH",
                estimateMinutes: 45,
                dueInDays: captureDueInDays,
            } });
        }
        if (!init?.method && url.includes("/api/ai/workflows/")) {
            if (holdWorkflowRecovery) return new Promise<Response>((resolve) => { resolveWorkflowRecovery = resolve; });
            return json(workflowRecoveryResponse ?? {
                id: "cworkflow123",
                goal: "Recovered task plan",
                status: "PLANNED",
                steps: [],
                approvals: [],
                createdAt: "2026-10-16T12:00:00.000Z",
                updatedAt: "2026-10-16T12:00:00.000Z",
            });
        }
        if (init?.method === "POST" && url.includes("/api/ai/workflows")) {
            return json({
                id: "cworkflow123",
                goal: "Create reviewed task steps",
                status: "PLANNED",
                steps: [],
                approvals: [],
                createdAt: "2026-10-16T12:00:00.000Z",
                updatedAt: "2026-10-16T12:00:00.000Z",
            }, 201);
        }
        if (url.includes("/api/tasks/view-data")) {
            const taskUrl = new URL(url, "http://localhost");
            const sortBy = taskUrl.searchParams.get("sortBy");
            if (malformedTaskResponse && sortBy !== "updatedAt") return json({ rows: [{ id: "task-1", title: 42 }], totalCount: 1, nextOffset: null });
            return json({ rows: sortBy === "updatedAt" ? [rows[1]] : [rows[0]], totalCount: 1, nextOffset: null });
        }
        if (url.includes("/api/views/aggregate")) {
            const metric = new URL(url, "http://localhost").searchParams.get("metric");
            if (malformedOpenMetric && metric === "my-open") return json({ kind: "metric", key: metric, scope: "task", value: "not-a-count", totalCount: 6 });
            const values: Record<string, number> = {
                "my-open": 6,
                "my-due-today": 2,
                "my-overdue": 1,
                "my-done-week": 4,
            };
            return json({ kind: "metric", key: metric, scope: "task", value: values[metric ?? ""] ?? 0, totalCount: values[metric ?? ""] ?? 0, timeZone: "Asia/Riyadh" });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe("Sabah daily dashboard", () => {
    it("renders actor-scoped work and compact metrics without a default chat composer", async () => {
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="plum" />);

        expect(screen.getByTestId("sabah-daily-dashboard-assistant-1")).toHaveAttribute("data-accent", "plum");
        expect(screen.getByRole("heading", { name: "Your work today" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Your work today" })).not.toHaveClass("sr-only");
        expect(screen.queryByRole("textbox", { name: /Message Sabah/i })).not.toBeInTheDocument();
        expect(screen.getByTestId("host-sabah-assistant-1")).toBeInTheDocument();

        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toHaveAttribute("href", "/tasks/task-1"));
        expect(screen.getByTestId("metric-my-open")).toHaveTextContent("6");
        expect(screen.getByRole("link", { name: "Resolve the review blocker" })).toHaveAttribute("href", "/tasks/task-2");
    });

    it("puts owned priority work before the expandable AI workbench on the initial mobile reading order", async () => {
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="sky" />);
        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toBeInTheDocument());

        const priorityHeading = screen.getByRole("heading", { name: "Priority work" });
        const workbenchHeading = screen.getByRole("heading", { name: "AI workbench" });
        expect(priorityHeading.compareDocumentPosition(workbenchHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByRole("button", { name: "Generate briefing" })).toBeInTheDocument();
    });

    it("keeps Sabah closed until explicitly opened and grounds a briefing in loaded task ids", async () => {
        const user = userEvent.setup();
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="sky" />);
        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toBeInTheDocument());

        expect(sabah.setHostVisibility).not.toHaveBeenCalled();
        await user.click(screen.getByRole("button", { name: "Ask Sabah" }));
        expect(sabah.setHostVisibility).toHaveBeenCalledWith("sabah-assistant-1", expect.anything(), true);
        expect(sabah.dispatch).toHaveBeenCalledWith({ type: "SHELL_MODE_CHANGED", mode: "PANEL" });

        await user.click(screen.getByRole("button", { name: "Generate briefing" }));
        expect(await screen.findByText(/Resolve the blocker first/)).toBeInTheDocument();
        const call = fetchMock.mock.calls.find(([input, init]) => String(input).includes("/api/ai/task-actions") && init?.method === "POST");
        expect(call).toBeTruthy();
        expect(JSON.parse(String(call?.[1]?.body))).toEqual(expect.objectContaining({
            action: "summarize",
            summaryMode: "briefing",
            tasks: expect.arrayContaining(["task-1", "task-2"]),
        }));
    });

    it("offers a reviewed breakdown preview and proposes workflow steps instead of creating immediately", async () => {
        const user = userEvent.setup();
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="ember" />);
        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toBeInTheDocument());

        await user.click(screen.getByRole("button", { name: "Break down selected work" }));
        expect(await screen.findByText("Confirm the launch scope")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Propose task plan" }));

        expect(await screen.findByText(/Review task plan/i)).toBeInTheDocument();
        const mutationCalls = fetchMock.mock.calls.filter(([input, init]) => {
            const url = String(input);
            return init?.method === "POST" && (url.includes("/api/tasks") || url.includes("/api/ai/task-actions") && JSON.parse(String(init?.body)).action === "breakdown");
        });
        expect(mutationCalls).toHaveLength(0);
        expect(fetchMock).toHaveBeenCalledWith("/api/ai/workflows", expect.objectContaining({ method: "POST" }));
    });

    it("renders an invalid aggregate as unknown instead of silently showing zero", async () => {
        malformedOpenMetric = true;
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="sage" />);

        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toBeInTheDocument());
        expect(screen.getByTestId("metric-my-open")).toHaveTextContent("Unknown");
        expect(screen.getByTestId("metric-my-open")).not.toHaveTextContent("0");
        expect(screen.getByTestId("metric-my-open")).toHaveTextContent("Unavailable");
    });

    it("reports malformed task rows instead of treating them as an empty dashboard", async () => {
        malformedTaskResponse = true;
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="sage" />);

        expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
        expect(screen.getByRole("alert")).toHaveTextContent(/priority task rows were not valid/i);
    });

    it("keeps briefing and workbench results separate and sends the explicit mode", async () => {
        const user = userEvent.setup();
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="sky" />);
        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toBeInTheDocument());

        await user.click(screen.getByRole("button", { name: "Generate briefing" }));
        expect(await screen.findByRole("heading", { name: "Sabah briefing", level: 4 })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Plan my day" }));
        expect(await screen.findByRole("region", { name: "Your day plan" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Sabah briefing", level: 4 })).toBeInTheDocument();

        const summaryCalls = fetchMock.mock.calls.filter(([input, init]) => String(input).includes("/api/ai/task-actions") && init?.method === "POST");
        expect(JSON.parse(String(summaryCalls.at(-1)?.[1]?.body))).toEqual(expect.objectContaining({ action: "summarize", summaryMode: "plan" }));
    });

    it("renders briefing evidence from the authorized server snapshot", async () => {
        const user = userEvent.setup();
        summarySourceTitle = "Server-authoritative launch brief";
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="sky" />);
        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toBeInTheDocument());

        await user.click(screen.getByRole("button", { name: "Generate briefing" }));

        expect(await screen.findByRole("link", { name: "Server-authoritative launch brief" })).toHaveAttribute("href", "/tasks/task-1");
    });

    it("ignores a briefing response after live data refresh advances the source generation", async () => {
        const user = userEvent.setup();
        holdSummaryResponse = true;
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="sky" />);
        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toBeInTheDocument());

        await user.click(screen.getByRole("button", { name: "Generate briefing" }));
        await waitFor(() => expect(resolveSummaryResponse).toBeTypeOf("function"));
        await user.click(screen.getByRole("button", { name: "Refresh" }));
        resolveSummaryResponse?.(json({
            summary: "• Stale response\n• Must not attach\n• After refresh",
            sourceSnapshot: [{ id: "task-1", title: "Stale task", status: "DOING", dueAt: null }, { id: "task-2", title: rows[1].title, status: "BLOCKED", dueAt: null }],
        }));

        await waitFor(() => expect(screen.queryByText("• Stale response\n• Must not attach\n• After refresh")).not.toBeInTheDocument());
    });

    it("reports a malformed authoritative AI snapshot instead of rendering prior rows", async () => {
        const user = userEvent.setup();
        malformedSummarySnapshot = true;
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="sky" />);
        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toBeInTheDocument());

        await user.click(screen.getByRole("button", { name: "Generate briefing" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(/authoritative task snapshot/i);
        expect(screen.queryByText("• Invalid\n• Stale\n• Evidence")).not.toBeInTheDocument();
    });

    it("keeps capture standalone and carries due date, effort, priority, and reviewed actor assignment into the workflow proposal", async () => {
        const user = userEvent.setup();
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="ember" viewId="view-1" />);
        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toBeInTheDocument());

        await user.type(screen.getByRole("textbox", { name: "Capture a note for Sabah" }), "Schedule stakeholder review in three days");
        await user.click(screen.getByRole("button", { name: "Prepare task proposal" }));
        expect(await screen.findByText("Schedule stakeholder review")).toBeInTheDocument();
        expect(screen.getByText(/due Oct 19/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Propose captured task" }));
        await screen.findByText(/Review task plan/);

        const workflowCall = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/ai/workflows" && init?.method === "POST");
        const workflowBody = JSON.parse(String(workflowCall?.[1]?.body));
        expect(workflowBody.steps[0].args).toEqual(expect.objectContaining({
            priority: "HIGH",
            effortHours: 0.75,
            assigneeIds: ["actor-1"],
        }));
        expect(workflowBody.steps[0].args).not.toHaveProperty("parentTaskId");
        expect(workflowBody.steps[0].args.dueAt).toBe("2026-10-19T20:59:59.999Z");
    });

    it("uses the Riyadh calendar day for relative due dates near UTC midnight", async () => {
        const user = userEvent.setup();
        vi.setSystemTime(new Date("2026-10-16T22:30:00.000Z"));
        captureDueInDays = 0;
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="ember" viewId="view-1" />);
        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toBeInTheDocument());

        await user.type(screen.getByRole("textbox", { name: "Capture a note for Sabah" }), "Review the brief today");
        await user.click(screen.getByRole("button", { name: "Prepare task proposal" }));
        expect(await screen.findByText(/due Oct 17/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Propose captured task" }));
        const workflowCall = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/ai/workflows" && init?.method === "POST");
        const workflowBody = JSON.parse(String(workflowCall?.[1]?.body));
        expect(workflowBody.steps[0].args.dueAt).toBe("2026-10-17T20:59:59.999Z");
    });

    it("gates a new proposal until saved workflow recovery has hydrated", async () => {
        const user = userEvent.setup();
        holdWorkflowRecovery = true;
        window.localStorage.setItem("sabah-dashboard-workflow:actor-1:view-1:assistant-1", JSON.stringify({ workflowId: "cworkflow123" }));
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="ember" viewId="view-1" />);
        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toBeInTheDocument());

        await user.type(screen.getByRole("textbox", { name: "Capture a note for Sabah" }), "Capture while recovery is pending");
        await user.click(screen.getByRole("button", { name: "Prepare task proposal" }));
        const propose = await screen.findByRole("button", { name: "Propose captured task" });
        expect(propose).toBeDisabled();

        resolveWorkflowRecovery?.(json({
            id: "cworkflow123",
            goal: "Recovered task plan",
            status: "PLANNED",
            steps: [],
            approvals: [],
            createdAt: "2026-10-16T12:00:00.000Z",
            updatedAt: "2026-10-16T12:00:00.000Z",
        }));
        await waitFor(() => expect(propose).not.toBeDisabled());
    });

    it("disables approval when reload has no exact server-authored review", async () => {
        window.localStorage.setItem("sabah-dashboard-workflow:actor-1:view-1:assistant-1", JSON.stringify({ workflowId: "cworkflow123" }));
        workflowRecoveryResponse = {
            id: "cworkflow123",
            goal: "Create reviewed task",
            status: "AWAITING_APPROVAL",
            steps: [{ id: "cmtr1wj9j0011wdaeiwesb3uq", clientStepId: "step-1", capability: "tasks.create", status: "APPROVAL_REQUIRED", dependsOn: [], confidence: 0, previewSummary: "Create reviewed task", entityLinks: [] }],
            approvals: [{ id: "cmtr1wu65001nwdaeaji35y3p", stepId: "cmtr1wj9j0011wdaeiwesb3uq", title: "Create reviewed task", risk: "REVERSIBLE_WRITE", status: "PENDING", expiresAt: "2026-10-17T12:00:00.000Z", requestedAt: "2026-10-16T12:00:00.000Z" }],
            createdAt: "2026-10-16T12:00:00.000Z",
            updatedAt: "2026-10-16T12:00:00.000Z",
        };
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="sky" viewId="view-1" />);

        const approval = await screen.findByRole("button", { name: "Approve and execute" });
        expect(approval).toBeDisabled();
        expect(screen.getByText(/exact server review is unavailable/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Refresh workflow status" })).toBeInTheDocument();
    });

    it("preserves verified task results when a partially executed plan is stopped", async () => {
        window.localStorage.setItem("sabah-dashboard-workflow:actor-1:view-1:assistant-1", JSON.stringify({ workflowId: "cworkflow123" }));
        workflowRecoveryResponse = {
            id: "cworkflow123", goal: "Partially completed child plan", status: "CANCELED",
            steps: [
                { id: "step-1", clientStepId: "first", capability: "tasks.create", status: "VERIFIED", dependsOn: [], confidence: 1, resultSummary: "Created the reviewed child task", entityLinks: [] },
                { id: "step-2", clientStepId: "second", capability: "tasks.create", status: "SKIPPED", dependsOn: [], confidence: 1, entityLinks: [] },
            ],
            approvals: [], createdAt: "2026-10-16T12:00:00.000Z", updatedAt: "2026-10-16T12:00:00.000Z",
        };
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="sky" viewId="view-1" />);

        expect(await screen.findByText("Created the reviewed child task")).toBeInTheDocument();
        expect(screen.queryByText(/discarded before a task write completed/i)).not.toBeInTheDocument();
        expect(screen.getByText(/completed task changes remain in place/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Refresh workflow status" })).toBeEnabled();
    });

    it("can refresh a stopped plan whose in-flight task later verifies", async () => {
        const user = userEvent.setup();
        window.localStorage.setItem("sabah-dashboard-workflow:actor-1:view-1:assistant-1", JSON.stringify({ workflowId: "cworkflow123" }));
        const snapshot = {
            id: "cworkflow123", goal: "Stopped in-flight task", status: "CANCELED",
            steps: [{ id: "step-1", clientStepId: "first", capability: "tasks.create", status: "RUNNING", dependsOn: [], confidence: 1, entityLinks: [] }],
            approvals: [], createdAt: "2026-10-16T12:00:00.000Z", updatedAt: "2026-10-16T12:00:00.000Z",
        };
        workflowRecoveryResponse = snapshot;
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="sky" viewId="view-1" />);
        const refresh = await screen.findByRole("button", { name: "Refresh workflow status" });
        expect(screen.queryByText(/discarded before a task write completed/i)).not.toBeInTheDocument();

        workflowRecoveryResponse = { ...snapshot, steps: [{ ...snapshot.steps[0], status: "VERIFIED", resultSummary: "Verified the task that was already in flight" }] };
        await user.click(refresh);
        expect(await screen.findByText("Verified the task that was already in flight")).toBeInTheDocument();
    });

    it.each(["VERIFIED", "RUNNING"])("names cancellation as stopping remaining steps after a %s write", async (status) => {
        window.localStorage.setItem("sabah-dashboard-workflow:actor-1:view-1:assistant-1", JSON.stringify({ workflowId: "cworkflow123" }));
        workflowRecoveryResponse = {
            id: "cworkflow123", goal: "Continue reviewed task steps", status: "AWAITING_APPROVAL",
            steps: [{ id: "step-1", clientStepId: "first", capability: "tasks.create", status, dependsOn: [], confidence: 1, entityLinks: [] }],
            approvals: [], createdAt: "2026-10-16T12:00:00.000Z", updatedAt: "2026-10-16T12:00:00.000Z",
        };
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="sky" viewId="view-1" />);
        expect(await screen.findByRole("button", { name: "Stop remaining steps" })).toBeEnabled();
        expect(screen.queryByRole("button", { name: "Discard plan" })).not.toBeInTheDocument();
    });

    it("discards a breakdown when the selected task changes instead of applying it to another task", async () => {
        const user = userEvent.setup();
        render(<SabahDailyDashboard blockId="assistant-1" userId="actor-1" accent="plum" />);
        await waitFor(() => expect(screen.getByRole("link", { name: "Prepare the launch brief" })).toBeInTheDocument());

        await user.click(screen.getByRole("button", { name: "Break down selected work" }));
        expect(await screen.findByText("Confirm the launch scope")).toBeInTheDocument();
        await user.selectOptions(screen.getByRole("combobox", { name: "Selected task for AI workbench" }), "task-2");
        expect(screen.queryByRole("button", { name: "Propose task plan" })).not.toBeInTheDocument();
    });
});
