// Pure environment checks used by the setup doctor and build helpers.

export type EnvCheck = {
    name: string;
    required: boolean;
    present: boolean;
    note?: string;
};

export type EnvReport = {
    ok: boolean;
    checks: EnvCheck[];
};

export function checkRequiredEnv(
    env: Record<string, string | undefined>,
    opts: { production?: boolean } = {},
): EnvReport {
    const required: Array<{ name: string; note?: string }> = [
        { name: "DATABASE_URL", note: "PostgreSQL connection string used by Prisma" },
        { name: "AUTH_SECRET", note: "Auth.js JWT signing secret (openssl rand -base64 32)" },
    ];
    if (opts.production) {
        required.push({
            name: "NEXTAUTH_URL",
            note: "Absolute base URL used for auth callbacks",
        });
    }
    const optional: Array<{ name: string; note: string }> = [
        { name: "CRON_SECRET", note: "Bearer token for /api/cron/* endpoints" },
        { name: "RESEND_API_KEY", note: "Transactional email (password reset)" },
        { name: "EMAIL_FROM", note: "Sender address for outbound email" },
        { name: "GLM_API_KEY", note: "AI report generation" },
        { name: "SABAH_CREDENTIAL_KEY", note: "Base64 32-byte key for provider credentials" },
        { name: "WEB_PUSH_VAPID_PUBLIC_KEY", note: "Web push notifications" },
    ];

    const checks: EnvCheck[] = [];
    for (const item of required) {
        checks.push({ name: item.name, required: true, present: Boolean(env[item.name]), note: item.note });
    }
    for (const item of optional) {
        checks.push({ name: item.name, required: false, present: Boolean(env[item.name]), note: item.note });
    }
    return { ok: checks.filter((c) => c.required).every((c) => c.present), checks };
}
