import { test, expect } from "@playwright/test";

const TEST_EMAIL = "e2e-test@test.com";
const TEST_PASSWORD = "TestPass123!";

test.describe("Authentication", () => {
    test("should show login page", async ({ page }) => {
        await page.goto("/login");
        await expect(page.getByRole("heading", { name: "WorkOps" })).toBeVisible();
        await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
        await expect(page.getByLabel("Password")).toBeVisible();
    });

    test("should reject invalid credentials", async ({ page }) => {
        await page.goto("/login");
        await page.getByRole("textbox", { name: "Email" }).fill("wrong@test.com");
        await page.getByLabel("Password").fill("wrongpassword");
        await page.getByRole("button", { name: /sign in/i }).click();
        // Error shows inside a div with destructive styling
        await expect(
            page.locator("[class*='destructive']")
        ).toBeVisible({ timeout: 15000 });
    });

    test("should login with valid credentials and redirect to dashboard", async ({ page }) => {
        await page.goto("/login");
        await page.getByRole("textbox", { name: "Email" }).fill(TEST_EMAIL);
        await page.getByLabel("Password").fill(TEST_PASSWORD);
        await page.getByRole("button", { name: /sign in/i }).click();
        // window.location.href = "/dashboard" triggers full page navigation
        await page.waitForURL("**/dashboard", { timeout: 30000 });
        await expect(page).toHaveURL(/dashboard/);
    });

    test("should redirect unauthenticated users to login", async ({ page }) => {
        await page.goto("/dashboard");
        await page.waitForURL("**/login**", { timeout: 15000 });
        await expect(page).toHaveURL(/login/);
    });
});
