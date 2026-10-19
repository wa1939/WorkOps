import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { getRunnerDeps } from "./runner-deps";

const reviewedOperationalNames = [
  "pmo.actions.get", "notes.get", "leave.getMine", "caseStudies.get", "reports.get",
  "support.search", "savedViews.search", "notifications.listMine", "team.capacity",
];

describe("production runner dependency bootstrap", () => {
  it("resolves reviewed operational capabilities through getRunnerDeps and is idempotent", () => {
    const first = getRunnerDeps();
    for (const name of reviewedOperationalNames) expect(() => first.registry.resolve(name)).not.toThrow();
    expect(getRunnerDeps().registry).toBe(first.registry);
    expect(() => getRunnerDeps()).not.toThrow();
  });

  it("wires a durable capability result store so idempotent replay and compensation are live", () => {
    const deps = getRunnerDeps();
    expect(deps.store).toBeDefined();
    expect(typeof deps.store?.getPriorResult).toBe("function");
    expect(typeof deps.store?.saveResult).toBe("function");
    expect(typeof deps.store?.markCompensated).toBe("function");
    expect(typeof deps.store?.isCompensated).toBe("function");
  });
});
