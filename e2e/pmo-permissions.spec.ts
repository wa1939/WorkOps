import { expect, test, type Page } from "@playwright/test";
import { loginAs, submitLogin } from "./helpers/auth";
import { createPmoAction, pmoName, type PmoRole } from "./helpers/pmo";

async function relogin(page: Page, role: Exclude<PmoRole, "inactive">) {
    await page.context().clearCookies();
    await loginAs(page, role);
}

test.describe.serial("PMO permission matrix", () => {
    test("allows owner, parent owner, direct manager, and admin to manage an action", async ({ page }) => {
        await loginAs(page, "admin");
        const action = await createPmoAction(page.request, "permission-allowed");

        for (const role of ["owner", "parentOwner", "manager", "admin"] as const) {
            await relogin(page, role);
            const response = await page.request.patch(`/api/pmo/actions/${action.taskId}`, {
                data: { description: `Managed by ${role}` },
            });
            expect(response.status(), `${role} should manage the action`).toBe(200);
        }
    });

    test("keeps unrelated members and viewers read-only across PMO mutation routes", async ({ page }) => {
        await loginAs(page, "admin");
        const action = await createPmoAction(page.request, "permission-read-only");
        const routes = [
            { path: `/api/pmo/actions/${action.taskId}`, method: "patch", data: { description: "Blocked" } },
            { path: `/api/pmo/actions/${action.taskId}/evidence`, method: "post", data: { label: "Blocked", url: "https://example.test/blocked" } },
            { path: `/api/pmo/actions/${action.taskId}/responses`, method: "post", data: { comment: "Blocked" } },
            { path: `/api/pmo/actions/${action.taskId}/follow-ups`, method: "post", data: { eventId: pmoName("missing-event"), confirmedSent: true, recipient: "blocked@example.test", subject: "Blocked", body: "Blocked" } },
            { path: `/api/pmo/actions/${action.taskId}/lifecycle`, method: "post", data: { action: "cancel", reason: "Blocked" } },
            { path: `/api/pmo/actions/${action.taskId}/draft/rewrite`, method: "post", data: { subject: "Blocked", body: "Blocked" } },
        ] as const;

        for (const role of ["member", "viewer"] as const) {
            await relogin(page, role);
            expect((await page.request.get(`/api/pmo/actions/${action.taskId}`)).status()).toBe(200);
            expect((await page.request.get(`/api/pmo/actions/${action.taskId}/draft`)).status()).toBe(200);
            for (const route of routes) {
                const response = route.method === "patch"
                    ? await page.request.patch(route.path, { data: route.data })
                    : await page.request.post(route.path, { data: route.data });
                expect(response.status(), `${role} ${route.path}`).toBe(403);
            }
            await page.goto(`/tasks/${action.taskId}`);
            await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
            await page.goto(`/pmo/actions/${action.taskId}/edit`);
            await expect(page).toHaveURL(`/tasks/${action.taskId}`);
        }
    });

    test("rejects inactive users at authentication", async ({ page }) => {
        await submitLogin(page, "inactive");
        await expect(page).toHaveURL(/\/login/);
        await expect(page.locator(".text-destructive")).toBeVisible();
    });

    test("keeps viewers read-only across shared settings and actions", async ({ page }) => {
        await loginAs(page, "viewer");
        const create = await page.request.post("/api/pmo/work-areas", { data: { name: pmoName("viewer-area") } });
        expect(create.status()).toBe(403);

        const contact = await page.request.post("/api/pmo/contacts", {
            data: { name: pmoName("blocked-contact"), email: "e2e-pmo-blocked-contact@test.com" },
        });
        expect(contact.status()).toBe(403);
        expect((await page.request.post("/api/pmo/actions", { data: {} })).status()).toBe(403);
    });
});
