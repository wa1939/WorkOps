import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const text = (path: string): string => readFileSync(resolve(root, path), "utf8");
const expectSecretAuth = (workflow: string): void => {
  const secretReference = `${String.fromCharCode(36)}CRON_SECRET`;
  expect(workflow).toContain(`-H "Authorization: Bearer ${secretReference}"`);
  expect(workflow).not.toContain(`Bearer ${"*".repeat(3)}`);
};

const expectDisabledByDefault = (workflow: string): void => {
  expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' || vars.SABAH_SCHEDULERS_ENABLED == 'true'");
  expect(workflow).toContain("environment: sabah-schedulers");
};

describe("Sabah scheduler deployment topology", () => {
  it("keeps sub-daily Sabah schedules out of Vercel Hobby cron configuration", () => {
    const config = JSON.parse(text("vercel.json")) as { crons?: Array<{ path?: string; schedule?: string }> };
    const paths = (config.crons ?? []).map((cron) => cron.path);
    expect(paths).not.toContain("/api/cron/sabah-jobs");
    expect(paths).not.toContain("/api/cron/sabah-monitors");
  });

  it("runs durable jobs every five minutes through a secret-authenticated GitHub workflow", () => {
    const workflow = text(".github/workflows/sabah-jobs.yml");
    expect(workflow).toContain('cron: "*/5 * * * *"');
    expect(workflow).toContain("secrets.APP_BASE_URL");
    expect(workflow).toContain("secrets.CRON_SECRET");
    expect(workflow).toContain("/api/cron/sabah-jobs");
    expect(workflow).toContain("timeout-minutes: 3");
    expectSecretAuth(workflow);
    expectDisabledByDefault(workflow);
  });

  it("runs proactive monitors hourly through a secret-authenticated GitHub workflow", () => {
    const workflow = text(".github/workflows/sabah-monitors.yml");
    expect(workflow).toContain('cron: "7 * * * *"');
    expect(workflow).toContain("secrets.APP_BASE_URL");
    expect(workflow).toContain("secrets.CRON_SECRET");
    expect(workflow).toContain("/api/cron/sabah-monitors");
    expect(workflow).toContain("timeout-minutes: 3");
    expectSecretAuth(workflow);
    expectDisabledByDefault(workflow);
  });
});
