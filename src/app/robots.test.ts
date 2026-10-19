import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots", () => {
    it("allows crawling while disallowing auth, API, and app prefixes", () => {
        const policy = robots();
        const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules];
        expect(rules).toHaveLength(1);
        expect(rules[0].allow).toBe("/");

        const disallowed = rules[0].disallow ?? [];
        for (const prefix of [
            "/api/",
            "/login",
            "/signup",
            "/forgot-password",
            "/reset-password",
            "/verify-email",
            "/dashboard",
            "/tasks",
            "/projects",
            "/kpis",
            "/notes",
            "/announcements",
            "/team",
            "/reports",
            "/planner",
            "/pmo",
            "/inbox",
            "/support",
            "/leave",
            "/time-entries",
            "/views",
            "/settings",
            "/admin",
            "/case-studies",
        ]) {
            expect(disallowed).toContain(prefix);
        }
    });

    it("advertises no sitemap or host when no base URL is configured", () => {
        const policy = robots();
        expect(policy.sitemap).toBeUndefined();
        expect(policy.host).toBeUndefined();
    });

    it("emits sitemap and host from the configured base URL without trailing slashes", () => {
        process.env.APP_BASE_URL = "https://workops.example.org/";
        try {
            const policy = robots();
            expect(policy.sitemap).toBe("https://workops.example.org/sitemap.xml");
            expect(policy.host).toBe("https://workops.example.org");
        } finally {
            delete process.env.APP_BASE_URL;
        }
    });

    it("never leaks a hardcoded corporate or placeholder domain", () => {
        delete process.env.APP_BASE_URL;
        delete process.env.NEXTAUTH_URL;
        const serialized = JSON.stringify(robots());
        expect(serialized).not.toMatch(/people-lab|neuravisor|localhost/);
    });
});
