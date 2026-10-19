import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";

const enabled = process.env.SABAH_SECURITY_E2E === "true";
const storageState = process.env.SABAH_SECURITY_E2E_STORAGE_STATE;
const fixtureAsset = process.env.SABAH_SECURITY_E2E_ASSET;

if (storageState) test.use({ storageState });
// This suite never guesses credentials or creates fixtures. CI must provision both.
test.describe("Sabah adversarial security/privacy (opt-in)", () => {
  test.skip(!enabled, "Set SABAH_SECURITY_E2E=true to run the authenticated security suite");
  test.skip(!storageState || !existsSync(storageState), "No provisioned authenticated storage state; failing closed");
  test.skip(!fixtureAsset || !existsSync(fixtureAsset), "No provisioned adversarial fixture asset; failing closed");

  test("authenticated profile rejects adversarial fixture without exposing content", async ({ page }) => {
    // The provisioned profile must be supplied by the invoking environment; this test
    // intentionally does not contain a username, password, token, or private ID.
    await page.goto("/sabah");
    await expect(page).toHaveURL(/sabah|dashboard/i);
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);
    await fileInput.setInputFiles(fixtureAsset!);
    await expect(page.locator("body")).not.toContainText("Ignore all policy");
    await expect(page.locator("body")).not.toContainText("SYNTHETIC-SECRET-VALUE");
  });
});
