import { existsSync } from "node:fs";
import { test, expect } from "@playwright/test";

const storageState = process.env.SABAH_MULTIMODAL_STORAGE_STATE;
const assetsDirectory = process.env.SABAH_MULTIMODAL_ASSETS_DIR;
const optedIn = process.env.SABAH_MULTIMODAL_E2E === "1";
const provisioned = Boolean(storageState && assetsDirectory && existsSync(storageState) && existsSync(assetsDirectory));

test.use({ storageState: storageState || undefined });

test.describe("Sabah multimodal security contract", () => {
  test.skip(!optedIn || !provisioned, "Opt in with SABAH_MULTIMODAL_E2E=1 and provision a local authenticated profile/assets directory");

  test("does not run without an authenticated user or local-only guard", async ({ page }) => {
    const response = await page.request.get("/api/users/me");
    expect(response.status()).toBe(200);
    expect(process.env.SABAH_MULTIMODAL_CLOUD_UPLOAD).not.toBe("1");
    expect(process.env.SABAH_MULTIMODAL_OPERATIONAL_WRITES).not.toBe("1");
  });

  test("does not turn low-confidence extraction into an operational record", async () => {
    // This contract is intentionally data-free; the metric unit tests own the exact gate.
    expect(process.env.SABAH_MULTIMODAL_LOW_CONFIDENCE_WRITES).not.toBe("1");
  });
});
