import { defineConfig, devices } from "@playwright/test";
import { assertLocalDatabaseUrl } from "./scripts/assert-local-database";

// This module is evaluated before Playwright invokes globalSetup. Keep the
// destructive E2E fixture boundary fail-closed at the runner boundary too.
assertLocalDatabaseUrl(process.env.DATABASE_URL ?? "", { requireDatabaseSuffix: "_test" });

process.env.CRON_SECRET ??= "e2e-cron-secret";
process.env.NEXTAUTH_SECRET ??= "e2e-nextauth-secret-not-for-production";

export default defineConfig({
    globalSetup: "./e2e/global-setup.ts",
    testDir: "./e2e",
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: "list",
    timeout: 60000,
    use: {
        baseURL: "http://localhost:3000",
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"], channel: "chrome" },
        },
    ],
    webServer: {
        command: "node --require ./e2e/helpers/provider-fixture.cjs ./node_modules/next/dist/bin/next dev",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 120000,
        env: {
            ...process.env,
            CRON_SECRET: process.env.CRON_SECRET,
            NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
            AUTH_SECRET: process.env.NEXTAUTH_SECRET,
            RESEND_API_KEY: "",
            GLM_API_KEY: "e2e-provider-fixture-key",
            E2E_PROVIDER_FIXTURE: "1",
            SABAH_PLATFORM_ENABLED: "true",
            SABAH_MEMORY_ENABLED: "true",
            SABAH_MULTIMODAL_ENABLED: "true",
        },
    },
});
