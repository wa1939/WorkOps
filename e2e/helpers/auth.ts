import type { Page } from "@playwright/test";
import { PMO_EMAILS, PMO_PASSWORD, type PmoRole } from "./pmo";

export async function submitLogin(page: Page, role: PmoRole): Promise<void> {
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Email" }).fill(PMO_EMAILS[role]);
    await page.getByLabel("Password").fill(PMO_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
}

export async function loginAs(page: Page, role: Exclude<PmoRole, "inactive">): Promise<void> {
    await submitLogin(page, role);
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

export async function loginAsEmail(page: Page, email: string): Promise<void> {
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByLabel("Password").fill(PMO_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
}
