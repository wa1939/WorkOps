import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

/**
 * Opt-in real-browser contract for the workspace intelligence flow.
 * Set SABAH_WORKSPACE_INTELLIGENCE_E2E=1 only with the approved local
 * authenticated environment. This spec never seeds, resets, deletes, or
 * accepts credentials/secrets.
 */
test.describe("Sabah workspace intelligence contract", () => {
  test.skip(!process.env.SABAH_WORKSPACE_INTELLIGENCE_E2E, "Set SABAH_WORKSPACE_INTELLIGENCE_E2E=1 to run the local authenticated contract");

  test("shows related sources and saves create-separately resolution", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Open Sabah/i }).click();
    const panel = page.getByRole("complementary", { name: /Sabah employee copilot/i });
    await expect(panel).toBeVisible();

    await panel.getByRole("textbox", { name: /Message Sabah/i }).fill("EVP project brief");
    await panel.getByRole("button", { name: /Send/i }).click();
    await expect(panel.getByText(/related work|sources/i).first()).toBeVisible();
    await panel.getByRole("button", { name: "CREATE_SEPARATELY" }).click();
    await panel.getByRole("textbox", { name: "Reason" }).fill("Separate approved workstream");
    await panel.getByRole("button", { name: "Submit resolution" }).click();
    // The current UI does not expose the workflow idempotency key, so this guarded contract verifies the real save response only; exact retry remains covered by the evaluator seam.
    await expect(panel.getByRole("status")).toHaveText("Resolution saved.");
  });
});
