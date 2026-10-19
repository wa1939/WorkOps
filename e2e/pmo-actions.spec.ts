import { expect, test, type Page } from "@playwright/test";
import { toDatabaseDate } from "../src/lib/pmo/date";
import { loginAs } from "./helpers/auth";
import { createPmoAction, PMO_EMAILS, PMO_IDS, pmoName, withPmoPrisma } from "./helpers/pmo";

type Parent = "project" | "caseStudy";

async function runWorkflow(page: Page, parent: Parent) {
    const scenario = `workflow-${parent.toLowerCase()}`;
    const created = await createPmoAction(page.request, scenario, { parent });
    const detailUrl = `/api/pmo/actions/${created.taskId}`;

    const initialResponse = await page.request.get(detailUrl);
    expect(initialResponse.status()).toBe(200);
    const initial = await initialResponse.json();
    expect(initial).toMatchObject({
        title: pmoName(scenario),
        priority: "MEDIUM",
        status: "WAITING",
        isPrivate: false,
        projectId: parent === "project" ? PMO_IDS.project : null,
        caseStudyId: parent === "caseStudy" ? PMO_IDS.caseStudy : null,
        externalAction: { overdueIntervalDays: 7 },
    });
    expect(initial.externalAction.reminderRules.map(({ daysBeforeDue }: { daysBeforeDue: number }) => daysBeforeDue).sort((a: number, b: number) => b - a)).toEqual([30, 7, 0]);

    const update = await page.request.patch(detailUrl, {
        data: {
            title: pmoName(`edited-${parent.toLowerCase()}`),
            description: `Edited ${parent} action`,
            priority: "HIGH",
            status: "DOING",
            dueDate: "2026-11-30",
        },
    });
    expect(update.status()).toBe(200);
    expect(await update.json()).toMatchObject({ title: pmoName(`edited-${parent.toLowerCase()}`), status: "DOING", priority: "HIGH" });

    const eventId = pmoName(`event-${parent.toLowerCase()}`);
    await withPmoPrisma(async (prisma) => {
        await prisma.followUpEvent.create({
            data: {
                id: eventId,
                externalActionId: created.externalActionId,
                triggerType: "PRE_DUE",
                scheduledDate: toDatabaseDate("2026-11-01"),
                dedupKey: eventId,
                ownerId: initial.externalAction.ownerId,
            },
        });
    });

    const draftResponse = await page.request.get(`${detailUrl}/draft`);
    expect(draftResponse.status()).toBe(200);
    const draft = await draftResponse.json();
    expect(draft).toMatchObject({ to: "e2e-pmo-external@test.com", scheduledEventId: eventId });
    expect(draft.subject).toContain(pmoName(`edited-${parent.toLowerCase()}`));
    expect(draft.body).toContain(parent === "project" ? "E2E PMO Project" : "E2E PMO Case");

    const rewrite = await page.request.post(`${detailUrl}/draft/rewrite`, { data: { subject: draft.subject, body: draft.body } });
    expect(rewrite.status()).toBe(502);
    expect(await rewrite.json()).toEqual({ error: "AI rewrite unavailable" });

    const unconfirmed = await page.request.post(`${detailUrl}/follow-ups`, {
        data: { eventId, confirmedSent: false, recipient: draft.to, subject: draft.subject, body: draft.body },
    });
    expect(unconfirmed.status()).toBe(400);

    const sent = await page.request.post(`${detailUrl}/follow-ups`, {
        data: { eventId, confirmedSent: true, recipient: draft.to, subject: draft.subject, body: draft.body },
    });
    expect(sent.status()).toBe(201);
    expect(await sent.json()).toMatchObject({ id: eventId, finalRecipient: draft.to, finalSubject: draft.subject });

    const response = await page.request.post(`${detailUrl}/responses`, { data: { comment: `External response for ${parent}` } });
    expect(response.status()).toBe(201);
    const rejectedClose = await page.request.post(`${detailUrl}/lifecycle`, { data: { action: "close" } });
    expect(rejectedClose.status()).toBe(400);
    expect(await rejectedClose.json()).toEqual({ error: "Add evidence or a closure note before closing" });

    const evidence = await page.request.post(`${detailUrl}/evidence`, {
        data: { label: `Evidence ${parent}`, url: `https://example.test/${parent}` },
    });
    expect(evidence.status()).toBe(201);
    const closed = await page.request.post(`${detailUrl}/lifecycle`, { data: { action: "close", closureNote: "Verified complete" } });
    expect(closed.status()).toBe(200);
    expect(await closed.json()).toMatchObject({ status: "DONE", externalAction: { closureNote: "Verified complete" } });
    expect((await page.request.post(`${detailUrl}/lifecycle`, { data: { action: "reopen" } })).status()).toBe(200);
    expect((await page.request.post(`${detailUrl}/lifecycle`, { data: { action: "cancel", reason: `Canceled ${parent} reason` } })).status()).toBe(200);
    expect((await page.request.post(`${detailUrl}/lifecycle`, { data: { action: "reopen" } })).status()).toBe(200);

    await withPmoPrisma(async (prisma) => {
        const task = await prisma.task.findUniqueOrThrow({
            where: { id: created.taskId },
            include: { externalAction: { include: { evidence: true, followUpEvents: true } }, comments: true, auditLogs: true },
        });
        expect(task).toMatchObject({ status: "WAITING", doneAt: null, externalAction: { closedAt: null, closedById: null, closureNote: null } });
        expect(task.comments).toHaveLength(1);
        expect(task.externalAction?.evidence).toHaveLength(1);
        expect(task.externalAction?.followUpEvents.find(({ id }) => id === eventId)).toMatchObject({ sentById: initial.externalAction.ownerId });
        expect(task.auditLogs.map(({ action }) => action)).toEqual(expect.arrayContaining(["draft_ai_rewrite_failure", "marked_sent", "response_recorded", "close", "cancel", "reopen"]));
        const cancellation = task.auditLogs.find(({ action }) => action === "cancel");
        expect(JSON.parse(cancellation?.metaJson ?? "{}")).toMatchObject({ reason: `Canceled ${parent} reason` });
    });
}

test.describe.serial("PMO external action workflows", () => {
    test.beforeEach(async ({ page }) => loginAs(page, "owner"));

    test("completes the full project workflow", async ({ page }) => runWorkflow(page, "project"));
    test("completes the full case-study workflow", async ({ page }) => runWorkflow(page, "caseStudy"));

    test("copies a draft and requires explicit confirmation before marking its scheduled event sent", async ({ page, context }) => {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        const created = await createPmoAction(page.request, "browser-confirmation");
        const owner = await withPmoPrisma((prisma) => prisma.user.findUniqueOrThrow({ where: { email: PMO_EMAILS.owner } }));
        const eventId = pmoName("browser-confirmation-event");
        await withPmoPrisma((prisma) => prisma.followUpEvent.create({
            data: {
                id: eventId,
                externalActionId: created.externalActionId,
                triggerType: "DUE",
                scheduledDate: toDatabaseDate("2026-12-31"),
                dedupKey: eventId,
                ownerId: owner.id,
            },
        }));

        await page.goto(`/tasks/${created.taskId}#follow-up`);
        await expect(page.getByRole("heading", { name: "Follow-up draft" })).toBeVisible();
        const originalSubject = await page.getByLabel("Subject").inputValue();
        const originalBody = await page.getByLabel("Body").inputValue();
        await page.getByRole("button", { name: "Preview AI rewrite" }).click();
        await expect(page.getByText("AI rewrite failed; your current draft is unchanged.")).toBeVisible();
        await expect(page.getByLabel("Subject")).toHaveValue(originalSubject);
        await expect(page.getByLabel("Body")).toHaveValue(originalBody);
        await expect(page.getByRole("button", { name: "Accept preview" })).toHaveCount(0);
        const markSent = page.getByRole("button", { name: "Mark scheduled follow-up sent" });
        await expect(markSent).toBeDisabled();
        await page.getByRole("button", { name: "Copy all" }).click();
        await expect(page.getByText("Copied. This has not been recorded as sent.")).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("e2e-pmo-external@test.com");
        await page.getByLabel("I independently confirm I sent this using my email client").check();
        await expect(markSent).toBeEnabled();
        await markSent.click();
        await expect(page.getByText("Follow-up recorded as explicitly confirmed sent.")).toBeVisible();
        await expect(page.getByRole("button", { name: "Record manual follow-up sent" })).toBeDisabled();
    });

    test("records a manual follow-up only after explicit confirmation", async ({ page }) => {
        const created = await createPmoAction(page.request, "manual-confirmation");
        await page.goto(`/tasks/${created.taskId}#follow-up`);

        const recordManual = page.getByRole("button", { name: "Record manual follow-up sent" });
        await expect(recordManual).toBeDisabled();
        await page.getByLabel("I independently confirm I sent this using my email client").check();
        await expect(recordManual).toBeEnabled();
        await recordManual.click();
        await expect(page.getByText("Follow-up recorded as explicitly confirmed sent.")).toBeVisible();

        await withPmoPrisma(async (prisma) => {
            const events = await prisma.followUpEvent.findMany({ where: { externalActionId: created.externalActionId } });
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({ triggerType: "MANUAL", sentById: expect.any(String), finalRecipient: "e2e-pmo-external@test.com" });
            expect(events[0].dedupKey).toMatch(/^manual:/);
        });
    });

    test("submits default, custom, and disabled overdue recurrence through the form", async ({ page }) => {
        async function createFromForm(scenario: string, configure?: () => Promise<void>) {
            const title = pmoName(scenario);
            await page.goto(`/pmo/actions/new?projectId=${PMO_IDS.project}`);
            await page.getByLabel("Action title").fill(title);
            await page.getByLabel("Requested action").fill(`Requested ${scenario}`);
            await page.getByLabel("Due date").fill("2026-12-31");
            await page.getByLabel("Accountable owner").click();
            await page.getByRole("option", { name: "E2E PMO Owner" }).click();
            await page.getByLabel("External contact").click();
            await page.getByRole("option", { name: "E2E PMO External" }).click();
            await configure?.();
            await page.getByRole("button", { name: "Create external action" }).click();
            await page.waitForURL("**/tasks/**");
            return title;
        }

        const defaultTitle = await createFromForm("recurrence-default", async () => {
            await expect(page.getByLabel("Repeat overdue reminders")).toBeChecked();
            await expect(page.getByLabel("Overdue repeat days")).toHaveValue("7");
        });
        const customTitle = await createFromForm("recurrence-custom", async () => {
            await page.getByLabel("Overdue repeat days").fill("14");
        });
        const disabledTitle = await createFromForm("recurrence-disabled", async () => {
            await page.getByLabel("Repeat overdue reminders").uncheck();
            await expect(page.getByLabel("Overdue repeat days")).toBeDisabled();
        });

        await withPmoPrisma(async (prisma) => {
            const tasks = await prisma.task.findMany({
                where: { title: { in: [defaultTitle, customTitle, disabledTitle] } },
                include: { externalAction: true },
            });
            const intervals = Object.fromEntries(tasks.map((task) => [task.title, task.externalAction?.overdueIntervalDays]));
            expect(intervals).toEqual({ [defaultTitle]: 7, [customTitle]: 14, [disabledTitle]: null });
        });
    });

    test("returns through exact PMO history and falls back safely", async ({ page }) => {
        await page.goto("/pmo/portfolio?ownerId=me");
        await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
        await page.getByRole("button", { name: "Quick Add" }).click();
        await page.getByRole("menuitem", { name: "New External Action" }).click();
        await expect(page).toHaveURL(/\/pmo\/actions\/new$/);
        await page.getByRole("button", { name: "Back" }).click();
        await expect(page).toHaveURL(/\/pmo\/portfolio\?ownerId=me$/);

        await page.goto("/pmo/settings?tab=contacts");
        await expect(page.getByRole("tab", { name: "External Contacts" })).toHaveAttribute(
            "data-state",
            "active",
        );
        await page.getByRole("button", { name: "Quick Add" }).click();
        await page.getByRole("menuitem", { name: "New External Action" }).click();
        await page.getByRole("button", { name: "Back" }).click();
        await expect(page).toHaveURL(/\/pmo\/settings\?tab=contacts$/);
        await expect(page.getByRole("tab", { name: "External Contacts" })).toHaveAttribute(
            "data-state",
            "active",
        );

        const created = await createPmoAction(page.request, "navigation-fallback");
        await page.evaluate(() => sessionStorage.clear());
        await page.goto(`/tasks/${created.taskId}`);
        await page.getByRole("button", { name: "Back" }).click();
        await expect(page).toHaveURL(/\/pmo$/);
    });

    test("keeps PMO navigation touch-friendly on mobile", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/pmo/settings?tab=contacts");

        const backBox = await page.getByRole("button", { name: "Back" }).boundingBox();
        expect(backBox?.height).toBeGreaterThanOrEqual(44);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            ),
        ).toBe(true);
    });

    test("keeps the external responsibility card semantic and responsive", async ({ page }) => {
        const mixedContactName = "John المسؤول الخارجي ذو الاسم الطويل جدًا External Partner";
        const contactResponse = await page.request.post("/api/pmo/contacts", {
            data: {
                name: mixedContactName,
                email: "e2e-pmo-long.external.contact@example.com",
                department: "إدارة تجربة الموظف Employee Experience Department",
                organization: "شركة شريكة International Partner Organization",
            },
        });
        expect(contactResponse.status()).toBe(201);
        const contact = await contactResponse.json() as { id: string };
        const created = await createPmoAction(page.request, "responsibility-card", {
            externalContactId: contact.id,
        });

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/tasks/${created.taskId}`);
        const card = page
            .getByRole("heading", { name: "External responsibility" })
            .locator("xpath=../..");

        for (const label of ["Email", "Department", "Organization", "Parent", "Work area"]) {
            await expect(card.getByText(label, { exact: true })).toBeVisible();
        }
        await expect(card.getByText("e2e-pmo-long.external.contact@example.com")).toHaveAttribute("dir", "ltr");
        await expect(card.getByText(mixedContactName)).toHaveAttribute("dir", "auto");
        expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

        const grid = card.locator("dl");
        expect(await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
        for (const width of [768, 1280]) {
            await page.setViewportSize({ width, height: 844 });
            expect(await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
            expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
    });
});
