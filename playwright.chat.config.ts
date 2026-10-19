import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Separate port from the developer's existing application; DB safety remains
// enforced by the normal E2E entry point and global setup.
export default defineConfig({
    ...base,
    use: { ...base.use, baseURL: "http://localhost:3015" },
    webServer: {
        ...(base.webServer as Exclude<typeof base.webServer, undefined | unknown[]>),
        command: "node --require ./e2e/helpers/provider-fixture.cjs ./node_modules/next/dist/bin/next dev -p 3015",
        url: "http://localhost:3015",
        reuseExistingServer: false,
        env: {
            ...((base.webServer as { env?: Record<string, string> }).env),
            NEXTAUTH_URL: "http://localhost:3015",
            AUTH_URL: "http://localhost:3015",
            SABAH_WRITES_ENABLED: "true",
        },
    },
});
