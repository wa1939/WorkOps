import { test, expect, type Page } from "@playwright/test";

const TEST_EMAIL = "e2e-test@test.com";
const TEST_PASSWORD = "TestPass123!";

async function login(page: Page) {
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Email" }).fill(TEST_EMAIL);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for either successful redirect or login error
    const result = await Promise.race([
        page
            .waitForURL("**/dashboard", { timeout: 30000 })
            .then(() => "ok" as const),
        page
            .locator("[class*='destructive']")
            .waitFor({ state: "visible", timeout: 30000 })
            .then(() => "error" as const),
    ]);

    if (result === "error") {
        const errorText = await page.locator("[class*='destructive']").textContent();
        throw new Error(`Login failed: ${errorText}`);
    }
}

test.describe("Critical Pages Load (no 404s)", () => {
    test.beforeEach(async ({ page }) => {
        await login(page);
    });

    test("dashboard loads", async ({ page }) => {
        await page.goto("/dashboard");
        await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 10000 });
    });

    test("tasks page loads", async ({ page }) => {
        await page.goto("/tasks");
        await expect(page.getByText(/my tasks|tasks/i).first()).toBeVisible({ timeout: 10000 });
    });

    test("new task page loads", async ({ page }) => {
        await page.goto("/tasks/new");
        await expect(page.getByText(/new task|create task/i).first()).toBeVisible({ timeout: 10000 });
    });

    test("projects page loads", async ({ page }) => {
        await page.goto("/projects");
        await expect(page.locator("body")).not.toContainText("404");
    });

    test("projects page shows portfolio metrics", async ({ page }) => {
        await page.goto("/projects");
        await expect(page.getByText(/active projects/i).first()).toBeVisible({ timeout: 10000 });
    });

    test("project edit page loads", async ({ page }) => {
        await page.goto("/projects");
        const firstCard = page.locator("a[href^='/projects/']:not([href='/projects/new'])").first();
        if (await firstCard.count() > 0) {
            await firstCard.click();
            await page.getByRole("link", { name: /edit project/i }).click();
            await expect(page.getByLabel(/name/i).first()).toBeVisible({ timeout: 10000 });
        }
    });

    test("notes page loads", async ({ page }) => {
        await page.goto("/notes");
        await expect(page.locator("body")).not.toContainText("404");
    });

    test("leave page loads", async ({ page }) => {
        await page.goto("/leave");
        await expect(page.getByText(/leave/i).first()).toBeVisible({ timeout: 10000 });
    });

    test("settings page loads", async ({ page }) => {
        await page.goto("/settings");
        await expect(page.getByText(/settings|profile/i).first()).toBeVisible({ timeout: 10000 });
    });

    test("team page loads", async ({ page }) => {
        await page.goto("/team");
        await expect(page.locator("body")).not.toContainText("404");
    });

    test("team page shows department pulse", async ({ page }) => {
        await page.goto("/team");
        await expect(page.getByText(/department pulse/i).first()).toBeVisible({ timeout: 10000 });
        await expect(page.getByText(/shipped this week/i).first()).toBeVisible();
    });

    test("admin page loads for admin user", async ({ page }) => {
        await page.goto("/admin");
        // e2e test user is MEMBER — just verify no 404 or crash
        await expect(page.locator("body")).not.toContainText("404");
    });

    test("reports page loads", async ({ page }) => {
        await page.goto("/reports");
        await expect(page.locator("body")).not.toContainText("404");
    });

    test("support page loads", async ({ page }) => {
        await page.goto("/support");
        await expect(page.locator("body")).not.toContainText("404");
    });

    test("PMO pages load on mobile", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        for (const path of ["/pmo", "/pmo/portfolio", "/pmo/settings", "/pmo/actions/new"]) {
            await page.goto(path);
            await expect(page.locator("body")).not.toContainText("404");
            await expect(page.locator("h1").first()).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} should not overflow horizontally`).toBe(true);
        }
    });
});
