import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { readDatabaseUrl } from "./scripts/assert-local-database";

export default defineConfig({
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    test: {
        environment: "node",
        include: ["scripts/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
        // Live migration suites inspect and backfill global unmapped rows.
        // They must not race other fixtures sharing the same test database.
        fileParallelism: !readDatabaseUrl(),
    },
});
