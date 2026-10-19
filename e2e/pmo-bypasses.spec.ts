import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { createPmoAction, PMO_IDS, pmoName, withPmoPrisma } from "./helpers/pmo";

test.describe.serial("PMO generic mutation bypasses", () => {
    test("rejects generic task, bulk, duplicate, claim, and AI undo mutations without changing closure metadata", async ({ page }) => {
        await loginAs(page, "owner");
        const action = await createPmoAction(page.request, "bypass-action");
        const before = await withPmoPrisma((prisma) => prisma.task.findUniqueOrThrow({
            where: { id: action.taskId },
            include: { externalAction: true, auditLogs: true },
        }));

        expect((await page.request.patch(`/api/tasks/${action.taskId}`, { data: { status: "DONE" } })).status()).toBe(409);
        expect((await page.request.patch(`/api/tasks/${action.taskId}`, { data: { dueAt: "2026-09-01T09:00:00.000Z" } })).status()).toBe(409);
        expect((await page.request.delete(`/api/tasks/${action.taskId}`)).status()).toBe(409);
        for (const data of [
            { taskIds: [action.taskId], action: "status", status: "DONE" },
            { taskIds: [action.taskId], action: "delete" },
        ]) {
            const response = await page.request.post("/api/tasks/bulk-update", { data });
            expect(response.status()).toBe(409);
            expect(await response.json()).toMatchObject({ rejectedIds: [action.taskId] });
        }
        expect((await page.request.post(`/api/tasks/${action.taskId}/duplicate`)).status()).toBe(409);
        expect((await page.request.post(`/api/tasks/${action.taskId}/claim`)).status()).toBe(409);

        const undo = await page.request.post("/api/ai/tasks/undo", { data: { taskIds: [action.taskId] } });
        expect(undo.status()).toBe(200);
        expect(await undo.json()).toMatchObject({ canceledCount: 0, canceledIds: [], skippedCount: 1 });

        const after = await withPmoPrisma((prisma) => prisma.task.findUniqueOrThrow({
            where: { id: action.taskId },
            include: { externalAction: true, auditLogs: true },
        }));
        expect(after.status).toBe(before.status);
        expect(after.doneAt).toEqual(before.doneAt);
        expect(after.externalAction).toMatchObject({
            closedAt: before.externalAction?.closedAt,
            closedById: before.externalAction?.closedById,
            closureNote: before.externalAction?.closureNote,
        });
        expect(after.auditLogs).toHaveLength(before.auditLogs.length);

        await page.goto(`/tasks/${action.taskId}`);
        await expect(page.getByRole("button", { name: /Due .*Click to change/ })).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Change due date in PMO edit" })).toHaveAttribute("href", `/pmo/actions/${action.taskId}/edit`);
    });

    test("blocks Kanban status movement for external actions", async ({ page }) => {
        await loginAs(page, "owner");
        const title = pmoName("kanban-action");
        await createPmoAction(page.request, "kanban-action", { title });
        await page.goto("/tasks?view=board");
        const card = page.getByRole("button", { name: new RegExp(title) });
        await expect(card).toHaveAttribute("aria-disabled", "true");
        await expect(card).toHaveAttribute("title", "Change external-action status from its PMO lifecycle controls");
    });

    test("rejects project and case-study work-area removal while actions exist", async ({ page }) => {
        await loginAs(page, "owner");
        await createPmoAction(page.request, "project-classification", { parent: "project" });
        await createPmoAction(page.request, "case-classification", { parent: "caseStudy" });
        await page.context().clearCookies();
        await loginAs(page, "parentOwner");

        for (const [kind, id] of [["projects", PMO_IDS.project], ["case-studies", PMO_IDS.caseStudy]] as const) {
            const response = await page.request.patch(`/api/${kind}/${id}`, { data: { workAreaId: null } });
            expect(response.status()).toBe(409);
            const parent = await page.request.get(`/api/${kind}/${id}`);
            expect((await parent.json()).workAreaId).toBe(PMO_IDS.workArea);
        }
    });
});
