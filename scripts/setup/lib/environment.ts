import { loadEnvConfig } from "@next/env";

/** Match Next.js environment-file precedence without logging credential material. */
export function loadSetupEnvironment(): void {
    loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info() {}, error() {} });
}
