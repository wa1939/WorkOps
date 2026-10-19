import { expect, test, type APIRequestContext } from "@playwright/test";
import { shiftCalendarDate, toRiyadhDate } from "../src/lib/pmo/date";
import { loginAs } from "./helpers/auth";
import { getPmoUser, PMO_IDS, pmoName, withPmoPrisma } from "./helpers/pmo";

type ActionInput = {
    scenario: string;
    ownerId: string;
    contactId: string;
    dueDate: string;
    projectId?: string;
    caseStudyId?: string;
    description: string;
};

async function createAction(request: APIRequestContext, input: ActionInput) {
    const response = await request.post("/api/pmo/actions", { data: {
        title: pmoName(input.scenario),
        description: input.description,
        ownerId: input.ownerId,
        externalContactId: input.contactId,
        dueDate: input.dueDate,
        projectId: input.projectId ?? null,
        caseStudyId: input.caseStudyId ?? null,
    } });
    expect(response.status()).toBe(201);
    return await response.json() as { taskId: string; externalActionId: string };
}

test.describe.serial("PMO portfolio", () => {
    test("groups actions, applies every filter, and exports safe next-reminder CSV", async ({ page }) => {
        await loginAs(page, "admin");
        const owner = await getPmoUser(page.request, "owner");
        const parentOwner = await getPmoUser(page.request, "parentOwner");
        const today = toRiyadhDate(new Date());
        const dueSoon = shiftCalendarDate(today, 7);
        const dueLater = shiftCalendarDate(today, 15);
        const overdue = shiftCalendarDate(today, -2);
        const secondAreaId = pmoName("portfolio-area");
        const secondProjectId = pmoName("portfolio-project");
        const secondContactId = pmoName("portfolio-contact");

        await withPmoPrisma(async (prisma) => {
            await prisma.workArea.create({ data: { id: secondAreaId, name: "E2E PMO Portfolio Area", normalizedName: pmoName("portfolio-area"), createdById: owner.id } });
            await prisma.project.create({ data: { id: secondProjectId, name: "E2E PMO Portfolio Project", ownerId: parentOwner.id, workAreaId: secondAreaId } });
            await prisma.projectMember.create({ data: { projectId: secondProjectId, userId: owner.id } });
            await prisma.externalContact.create({
                data: {
                    id: secondContactId,
                    name: "E2E PMO Portfolio Contact",
                    email: "e2e-pmo-portfolio-contact@test.com",
                    normalizedEmail: "e2e-pmo-portfolio-contact@test.com",
                    department: "+Formula Department",
                    createdById: owner.id,
                },
            });
        });

        const projectAction = await createAction(page.request, {
            scenario: "portfolio-project-action",
            ownerId: owner.id,
            contactId: PMO_IDS.contact,
            dueDate: dueSoon,
            projectId: PMO_IDS.project,
            description: "=2+2 portfolio description",
        });
        const caseAction = await createAction(page.request, {
            scenario: "portfolio-case-action",
            ownerId: parentOwner.id,
            contactId: secondContactId,
            dueDate: dueLater,
            caseStudyId: PMO_IDS.caseStudy,
            description: "Case portfolio description",
        });
        const overdueAction = await createAction(page.request, {
            scenario: "portfolio-overdue-action",
            ownerId: parentOwner.id,
            contactId: secondContactId,
            dueDate: overdue,
            projectId: secondProjectId,
            description: "Overdue portfolio description",
        });
        expect((await page.request.patch(`/api/pmo/actions/${projectAction.taskId}`, { data: { status: "DOING" } })).status()).toBe(200);
        await withPmoPrisma((prisma) => prisma.task.update({ where: { id: overdueAction.taskId }, data: { status: "BLOCKED" } }));
        expect((await page.request.post(`/api/pmo/actions/${projectAction.taskId}/evidence`, {
            data: { label: "-Formula evidence", url: "https://example.test/portfolio-evidence" },
        })).status()).toBe(201);

        const nextReminder = today;

        const loadRows = async (params: Record<string, string>) => {
            const query = new URLSearchParams({ ownerId: "all", ...params });
            const response = await page.request.get(`/api/pmo/portfolio?${query}`);
            expect(response.status()).toBe(200);
            return (await response.json()).rows as Array<{ id: string; workAreaName: string; nextReminder: string | null }>;
        };
        const matrixIds = new Set([projectAction.taskId, caseAction.taskId, overdueAction.taskId]);
        const ids = (rows: Array<{ id: string }>) => rows.map(({ id }) => id).filter((id) => matrixIds.has(id));

        expect(ids(await loadRows({}))).toEqual(expect.arrayContaining([projectAction.taskId, caseAction.taskId, overdueAction.taskId]));
        expect(ids(await loadRows({ ownerId: owner.id }))).toEqual([projectAction.taskId]);
        expect(ids(await loadRows({ workAreaId: PMO_IDS.workArea }))).toEqual(expect.arrayContaining([projectAction.taskId, caseAction.taskId]));
        expect(ids(await loadRows({ parentType: "project" }))).toEqual(expect.arrayContaining([projectAction.taskId, overdueAction.taskId]));
        expect(ids(await loadRows({ parentType: "case-study" }))).toEqual([caseAction.taskId]);
        expect(ids(await loadRows({ parentType: "project", parentId: PMO_IDS.project }))).toEqual([projectAction.taskId]);
        expect(ids(await loadRows({ contactId: PMO_IDS.contact }))).toEqual([projectAction.taskId]);
        expect(ids(await loadRows({ status: "DOING" }))).toEqual([projectAction.taskId]);
        expect(ids(await loadRows({ dueBucket: "DUE_7" }))).toEqual([projectAction.taskId]);
        expect(ids(await loadRows({ dueBucket: "DUE_30" }))).toEqual([caseAction.taskId]);
        expect(ids(await loadRows({ dueBucket: "OVERDUE" }))).toEqual([overdueAction.taskId]);
        expect(ids(await loadRows({ dueStart: dueSoon, dueEnd: dueSoon }))).toEqual([projectAction.taskId]);
        expect(ids(await loadRows({ evidence: "has" }))).toEqual([projectAction.taskId]);
        expect(ids(await loadRows({ evidence: "missing" }))).toEqual(expect.arrayContaining([caseAction.taskId, overdueAction.taskId]));
        expect((await loadRows({ parentType: "project", parentId: PMO_IDS.project }))[0].nextReminder).toBe(nextReminder);

        const csv = await page.request.get(`/api/pmo/export?ownerId=all&parentType=project&parentId=${PMO_IDS.project}`);
        expect(csv.status()).toBe(200);
        const body = await csv.text();
        expect(body).toContain("Next reminder");
        expect(body).toContain(nextReminder);
        expect(body).toContain("'=2+2 portfolio description");
        expect(body).toContain("'-Formula evidence: https://example.test/portfolio-evidence");

        await page.goto("/pmo/portfolio?ownerId=all");
        await expect(page.getByRole("heading", { name: "E2E PMO Area" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "E2E PMO Portfolio Area" })).toBeVisible();
        await page.getByLabel("Status").click();
        await page.getByRole("option", { name: "DOING", exact: true }).click();
        await page.getByRole("button", { name: "Apply filters" }).click();
        await expect(page).toHaveURL(/status=DOING/);
        await expect(page.getByText(pmoName("portfolio-project-action"), { exact: true })).toBeVisible();
        await expect(page.getByText(pmoName("portfolio-case-action"), { exact: true })).toHaveCount(0);
    });

    test("keeps portfolio controls accessible and usable on mobile", async ({ page }) => {
        await loginAs(page, "owner");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/pmo/portfolio?ownerId=all");
        await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible();
        for (const label of ["Owner", "Work area", "Parent type", "Parent", "External contact", "Status", "Due bucket", "Evidence", "Due from", "Due through"]) {
            await expect(page.getByLabel(label, { exact: true })).toBeVisible();
        }
        await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});
