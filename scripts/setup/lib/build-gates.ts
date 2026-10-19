// Explicit opt-in gates for build-time database work (Vercel and CI).
// Defaults are OFF: a build must never touch a database implicitly.

export function shouldInitDatabaseOnBuild(env: Record<string, string | undefined>): boolean {
    return env.WORKOPS_DB_INIT_ON_BUILD === "1";
}

export function shouldMigrateOnBuild(env: Record<string, string | undefined>): boolean {
    return env.WORKOPS_DB_MIGRATE_ON_BUILD === "1";
}

export function shouldBootstrapAdminOnBuild(env: Record<string, string | undefined>): boolean {
    return env.WORKOPS_BOOTSTRAP_ADMIN_ON_BUILD === "1";
}
