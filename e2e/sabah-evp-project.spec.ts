import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { evpProjectFixture } from "../src/lib/sabah/fixtures/evp-project";

/**
 * Real-browser contract for the approved EVP workflow.
 * Opt in with SABAH_EVP_E2E=1 after the existing loopback DB/auth global setup
 * succeeds. This spec never seeds, resets, or deletes data.
 */
test.describe("Sabah EVP cross-module workflow", () => {
    test.skip(!process.env.SABAH_EVP_E2E, "Set SABAH_EVP_E2E=1 to run the local authenticated acceptance contract");

    test("submits the approved charter and reads back the strategic project", async ({ page }) => {
        await loginAs(page, "admin");
        await page.goto("/projects/new");
        await expect(page.getByRole("heading", { name: /create new project/i })).toBeVisible();
        await page.getByRole("textbox", { name: "Project name", exact: true }).fill(evpProjectFixture.name);
        await page.getByRole("textbox", { name: "Objective", exact: true }).fill(evpProjectFixture.objective);
        await page.getByRole("textbox", { name: "Scope", exact: true }).fill(evpProjectFixture.scope);
        await page.getByLabel("Start date", { exact: true }).fill(evpProjectFixture.startAt.slice(0, 10));
        await page.getByLabel("Due date", { exact: true }).fill(evpProjectFixture.dueAt.slice(0, 10));
        await expect(page.getByLabel("Implementation duration")).toContainText("6 months");
        await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(evpProjectFixture.name);
        await expect(page.getByRole("textbox", { name: "Objective", exact: true })).toHaveValue(evpProjectFixture.objective);

        await page.getByRole("button", { name: "Create Project" }).click();
        await expect(page).toHaveURL(/\/projects(?:\?.*)?$/);
        const projectLink = page.getByRole("link").filter({ has: page.getByRole("heading", { name: evpProjectFixture.name, exact: true }) }).first();
        await expect(projectLink).toBeVisible();
        await projectLink.click();
        await expect(page).toHaveURL(/\/projects\/[^/]+$/);
        await expect(page.getByRole("heading", { name: evpProjectFixture.name, exact: true })).toBeVisible();
        await expect(page.getByText(evpProjectFixture.objective, { exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
    });
});
