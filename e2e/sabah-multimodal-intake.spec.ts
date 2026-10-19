import { existsSync } from "node:fs";
import { test, expect } from "@playwright/test";

const storageState = process.env.SABAH_MULTIMODAL_STORAGE_STATE;
const assetsDirectory = process.env.SABAH_MULTIMODAL_ASSETS_DIR;
const optedIn = process.env.SABAH_MULTIMODAL_E2E === "1";
const provisioned = Boolean(storageState && assetsDirectory && existsSync(storageState) && existsSync(assetsDirectory));

test.use({ storageState: storageState || undefined });

test.describe("Sabah multimodal intake contract", () => {
  test.skip(!optedIn || !provisioned, "Opt in with SABAH_MULTIMODAL_E2E=1 and provision a local authenticated profile/assets directory");

  test("requires an authenticated local profile before intake", async ({ page }) => {
    const response = await page.request.get("/api/users/me");
    expect(response.status()).toBe(200);
    const body: unknown = await response.json();
    expect(body).toBeTruthy();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/dashboard/);
  });

  test("keeps the contract local and review-safe", async () => {
    expect(process.env.SABAH_MULTIMODAL_CLOUD_UPLOAD).not.toBe("1");
    expect(process.env.SABAH_MULTIMODAL_OPERATIONAL_WRITES).not.toBe("1");
  });
});
