/**
 * depends on Plan 3 T4 form-context mounting
 */
import { test, expect } from "@playwright/test";

/**
 * Field-protection E2E: Sabah must never overwrite a user-entered value.
 * The suggestion response is stubbed at the route level; the app otherwise runs.
 */
test.describe("Sabah field assistance", () => {
    test.skip("requires Plan 3 T4 form context on /projects/new", async ({ page }) => {
        await page.route("**/api/ai/suggest**", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    suggestions: [
                        { fieldName: "name", base: "", proposed: "Sabah project name", sourceRefs: ["ctx-1"], confidence: 0.92 },
                        { fieldName: "objective", base: "", proposed: "Proposed objective", sourceRefs: ["ctx-1"], confidence: 0.9 },
                    ],
                }),
            });
        });

        await page.goto("/projects/new");
        const nameInput = page.getByLabel(/name/i).first();
        await nameInput.fill("My own project");

        await page.getByRole("button", { name: /Fill empty fields only/i }).first().click();
        const applyButton = page.getByRole("button", { name: /Apply 1 field/i }).first();
        await applyButton.click();

        await expect(nameInput).toHaveValue("My own project");
        const objective = page.getByLabel(/objective/i).first();
        await expect(objective).toHaveValue("Proposed objective");
        await expect(page.getByText(/0 overwritten/).first()).toBeVisible();
    });
});
