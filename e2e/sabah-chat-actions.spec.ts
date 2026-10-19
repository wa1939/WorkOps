import { expect, test, type Page } from "@playwright/test";
import type { WorkflowSnapshot } from "../src/lib/sabah/workflows/schemas";
import { loginAs } from "./helpers/auth";
import { PMO_EMAILS, withPmoPrisma } from "./helpers/pmo";

const USER_ACTION = "add six tasks for today";
const WORKFLOW_GOAL = "Add six tasks for today";
const CREATE6_TASK_TITLES = [
    "e2e-pmo-chat-create6-Prepare daily stand-up notes",
    "e2e-pmo-chat-create6-Review incoming requests",
    "e2e-pmo-chat-create6-Update the team action log",
    "e2e-pmo-chat-create6-Check today's delivery risks",
    "e2e-pmo-chat-create6-Draft the afternoon status update",
    "e2e-pmo-chat-create6-Close out today's follow-ups",
] as const;

type ApiTask = {
    id: string;
    title: string;
    createdById?: string | null;
    dueAt?: string | null;
    assignments?: Array<{ userId: string }>;
};
type DbTask = {
    id: string;
    title: string;
    createdById: string | null;
    dueAt: Date | null;
    assignments: Array<{ userId: string }>;
};

test.describe.serial("Sabah chat-first governed task actions", () => {
    test.setTimeout(120_000);

    async function readFixtureTasks(page: Page, actorId: string): Promise<{ api: ApiTask[]; db: DbTask[] }> {
        const response = await page.request.get(`/api/tasks?search=${encodeURIComponent("e2e-pmo-chat-create6-")}`);
        expect(response.status()).toBe(200);
        const apiRows = (await response.json()) as ApiTask[];
        const api = apiRows.filter((task) =>
            (CREATE6_TASK_TITLES as readonly string[]).includes(task.title) && task.createdById === actorId,
        );
        const db = await withPmoPrisma((prisma) => prisma.task.findMany({
            where: { title: { in: [...CREATE6_TASK_TITLES] }, createdById: actorId },
            select: { id: true, title: true, createdById: true, dueAt: true, assignments: { select: { userId: true } } },
        }));
        return { api, db };
    }

    function expectExactlySix(tasks: { title: string }[]): void {
        expect(tasks).toHaveLength(6);
        expect(tasks.map(({ title }) => title).sort()).toEqual([...CREATE6_TASK_TITLES].sort());
        expect(new Set(tasks.map(({ title }) => title)).size).toBe(6);
    }

    async function matchingWorkflow(page: Page): Promise<WorkflowSnapshot | undefined> {
        const response = await page.request.get("/api/ai/workflows?limit=100");
        expect(response.status()).toBe(200);
        const body = (await response.json()) as { workflows: WorkflowSnapshot[] };
        const matches = body.workflows.filter((workflow) =>
            workflow.goal === WORKFLOW_GOAL && workflow.steps.some((step) => step.capability === "tasks.createMany"),
        );
        return matches[0];
    }

    function proposalFromChatStream(body: string): {
        goal: string;
        steps: Array<{ capability: string; args: { allowPartial: boolean; tasks: Array<{ title: string; dueAt: string; assigneeIds: string[] }> } }>;
    } {
        const frames = body.split(/\r?\n\r?\n/).filter((frame) => frame.trim().startsWith("data: "));
        for (const frame of frames) {
            const data = frame.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice("data: ".length).trim();
            if (!data || data === "[DONE]") continue;
            const event = JSON.parse(data) as { type?: string; name?: string; params?: unknown };
            if (event.type === "tool_result" && event.name === "proposeWorkflow" && event.params && typeof event.params === "object") {
                return event.params as ReturnType<typeof proposalFromChatStream>;
            }
        }
        throw new Error("The authenticated chat stream did not contain a proposeWorkflow payload");
    }

    test("previews, recovers, approves, verifies, and retries six actor-owned tasks without duplicates", async ({ page }, testInfo) => {
        await loginAs(page, "owner");
        const actor = await withPmoPrisma((prisma) => prisma.user.findUniqueOrThrow({
            where: { email: PMO_EMAILS.owner },
            select: { id: true },
        }));

        await page.goto("/dashboard");
        await expect(page.getByRole("button", { name: /Open Sabah/i })).toBeVisible();
        await page.getByRole("button", { name: /Open Sabah/i }).click();
        const shell = page.getByRole("complementary", { name: /Sabah employee copilot/i });
        await expect(shell).toBeVisible();
        const tabs = shell.getByRole("tablist", { name: /Sabah sections/i });
        await expect(tabs).toBeVisible();
        await expect(tabs.getByRole("tab", { name: /Plan/i })).toHaveCount(0);

        const initialTasks = await readFixtureTasks(page, actor.id);
        expect(initialTasks.api).toHaveLength(0);
        expect(initialTasks.db).toHaveLength(0);

        const composer = shell.getByRole("textbox", { name: /Message Sabah/i });
        const send = shell.getByRole("button", { name: /Send/i });
        await composer.fill(USER_ACTION);
        const chatResponsePromise = page.waitForResponse((response) =>
            response.url().endsWith("/api/ai/chat") && response.request().method() === "POST",
        );
        await send.click();
        const chatResponse = await chatResponsePromise;
        expect(chatResponse.ok()).toBe(true);
        const chatBody = await chatResponse.text();
        const proposal = proposalFromChatStream(chatBody);
        expect(proposal).toMatchObject({
            goal: WORKFLOW_GOAL,
            steps: [{ capability: "tasks.createMany", args: { allowPartial: false } }],
        });
        expect(proposal.steps[0].args.tasks).toHaveLength(6);
        expect(proposal.steps[0].args.tasks.map(({ title }) => title)).toEqual([...CREATE6_TASK_TITLES]);
        expect(proposal.steps[0].args.tasks.every(({ assigneeIds }) => assigneeIds.length === 1 && assigneeIds[0] === actor.id)).toBe(true);
        expect(proposal.steps[0].args.tasks.every(({ dueAt }) => /T23:59:59\+03:00$/.test(dueAt))).toBe(true);

        const compactAction = page.getByRole("region", { name: "Sabah action" });
        await expect(compactAction).toBeVisible({ timeout: 30_000 });
        await compactAction.getByRole("button", { name: /show details|preview/i }).click();
        const preview = page.getByRole("region", { name: /Sabah action preview/i });
        await expect(preview).toBeVisible({ timeout: 30_000 });
        for (const title of CREATE6_TASK_TITLES) await expect(preview).toContainText(title);
        // Proposal and approval are rendered in the transcript; no Plan tab or
        // second dashboard is part of this flow.
        await expect(tabs.getByRole("tab", { name: /Plan/i })).toHaveCount(0);
        await expect(compactAction.getByRole("button", { name: /approve|confirm|run/i }).first()).toBeVisible({ timeout: 30_000 });
        await page.screenshot({ path: testInfo.outputPath("chat-first-pending-approval.png") });

        const pendingTasks = await readFixtureTasks(page, actor.id);
        expect(pendingTasks.api).toHaveLength(0);
        expect(pendingTasks.db).toHaveLength(0);

        await expect.poll(async () => (await matchingWorkflow(page))?.status ?? "", { timeout: 30_000 }).toBe("AWAITING_APPROVAL");
        const pendingWorkflow = await matchingWorkflow(page);
        expect(pendingWorkflow).toBeDefined();
        expect(pendingWorkflow?.status).toBe("AWAITING_APPROVAL");
        expect(pendingWorkflow?.approvals.filter((approval) => approval.status === "PENDING")).toHaveLength(1);
        expect(pendingWorkflow?.actorId).toBe(actor.id);
        const workflowId = pendingWorkflow!.id;

        // A full reload must restore the active conversation's pending approval.
        await page.reload({ waitUntil: "networkidle" });
        await page.getByRole("button", { name: /Open Sabah/i }).click();
        const recoveredShell = page.getByRole("complementary", { name: /Sabah employee copilot/i });
        await expect(recoveredShell).toBeVisible({ timeout: 30_000 });
        const recoveredTabs = recoveredShell.getByRole("tablist", { name: /Sabah sections/i });
        await expect(recoveredTabs.getByRole("tab", { name: /Plan/i })).toHaveCount(0);
        const recoveredCompactAction = page.getByRole("region", { name: "Sabah action" });
        await expect(recoveredCompactAction).toBeVisible({ timeout: 30_000 });
        await recoveredCompactAction.getByRole("button", { name: /show details|preview/i }).click();
        const recoveredPreview = page.getByRole("region", { name: /Sabah action preview/i });
        await expect(recoveredPreview).toBeVisible({ timeout: 30_000 });
        for (const title of CREATE6_TASK_TITLES) await expect(recoveredPreview).toContainText(title);
        const recoveredApprove = recoveredCompactAction.getByRole("button", { name: /approve|confirm|run/i }).first();
        await expect(recoveredApprove).toBeVisible();

        const stillPendingTasks = await readFixtureTasks(page, actor.id);
        expect(stillPendingTasks.api).toHaveLength(0);
        expect(stillPendingTasks.db).toHaveLength(0);

        let decisionPosts = 0;
        let executePosts = 0;
        page.on("request", (request) => {
            if (request.method() !== "POST") return;
            if (/\/api\/ai\/workflows\/[^/]+\/decision$/.test(request.url())) decisionPosts += 1;
            if (/\/api\/ai\/workflows\/[^/]+\/execute$/.test(request.url())) executePosts += 1;
        });

        await expect(recoveredApprove).toBeEnabled();
        // The inline control must suppress the second click while the first
        // decision/execution is in flight.
        await recoveredApprove.dblclick();
        const verifiedResult = page.getByRole("region", { name: /Verified result/i });
        await expect(verifiedResult).toBeVisible({ timeout: 60_000 });
        await page.screenshot({ path: testInfo.outputPath("chat-first-verified-result.png") });
        await expect.poll(() => decisionPosts, { timeout: 10_000 }).toBe(1);
        await expect.poll(() => executePosts, { timeout: 10_000 }).toBe(1);

        const retryResponses = await Promise.all([
            page.request.post(`/api/ai/workflows/${workflowId}/execute`),
            page.request.post(`/api/ai/workflows/${workflowId}/execute`),
        ]);
        for (const response of retryResponses) {
            expect(response.status()).toBe(200);
            expect((await response.json() as WorkflowSnapshot).status).toBe("COMPLETED");
        }

        const finalTasks = await readFixtureTasks(page, actor.id);
        expectExactlySix(finalTasks.api);
        expectExactlySix(finalTasks.db);
        expect(finalTasks.api.every((task) => task.createdById === actor.id)).toBe(true);
        expect(finalTasks.api.every((task) => task.assignments?.some(({ userId }) => userId === actor.id))).toBe(true);
        expect(finalTasks.db.every((task) => task.createdById === actor.id && task.assignments.some(({ userId }) => userId === actor.id))).toBe(true);
        const riyadhDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).reduce<Record<string, string>>((parts, part) => {
            if (part.type !== "literal") parts[part.type] = part.value;
            return parts;
        }, {});
        const riyadhDateIso = `${riyadhDate.year}-${riyadhDate.month}-${riyadhDate.day}`;
        const expectedDueAt = new Date(`${riyadhDateIso}T23:59:59+03:00`).toISOString();
        expect(finalTasks.api.every((task) => task.dueAt === expectedDueAt)).toBe(true);
        expect(finalTasks.db.every((task) => task.dueAt?.toISOString() === expectedDueAt)).toBe(true);

        const storedWorkflow = await withPmoPrisma((prisma) => prisma.aiWorkflow.findUniqueOrThrow({
            where: { id: workflowId },
            include: { steps: true, approvals: true },
        }));
        expect(storedWorkflow).toMatchObject({ actorId: actor.id, status: "COMPLETED" });
        expect(storedWorkflow.conversationId).toEqual(expect.any(String));
        expect(storedWorkflow.steps).toHaveLength(1);
        expect(storedWorkflow.steps[0]).toMatchObject({ capability: "tasks.createMany", status: "VERIFIED" });
        expect(storedWorkflow.approvals).toHaveLength(1);
        expect(storedWorkflow.approvals[0]).toMatchObject({ status: "APPROVED", requestedById: actor.id, decidedById: actor.id, decisionType: "APPROVE" });
        // A later proposal must not erase the first result or authorize more writes.
        await recoveredShell.getByRole("textbox", { name: /Message Sabah/i }).fill("Add six tasks for today as another action.");
        const secondStream = page.waitForResponse(response => response.url().endsWith("/api/ai/chat") && response.request().method() === "POST");
        await recoveredShell.getByRole("button", { name: /^Send$/i }).click();
        expect(proposalFromChatStream(await (await secondStream).text()).goal).toBe("Prepare another six-task action");
        await expect(recoveredShell.getByTestId("sabah-action-row")).toHaveCount(2, { timeout: 30_000 });
        await expect(recoveredShell.getByTestId("sabah-verified-result")).toBeVisible();
        // Preflight replaces the provisional goal label with its authoritative preview.
        await expect(recoveredShell.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
        expectExactlySix((await readFixtureTasks(page, actor.id)).db);
        await page.reload({ waitUntil: "networkidle" });
        await page.getByRole("button", { name: /Open Sabah/i }).click();
        const finalShell = page.getByRole("complementary", { name: /Sabah employee copilot/i });
        await expect(finalShell.getByTestId("sabah-action-row")).toHaveCount(2, { timeout: 30_000 });
        await expect(finalShell.getByTestId("sabah-verified-result")).toBeVisible();
        expectExactlySix((await readFixtureTasks(page, actor.id)).db);
        await page.screenshot({ path: testInfo.outputPath("chat-first-multiple-actions-recovered.png") });
    });
});
