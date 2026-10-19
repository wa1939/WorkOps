import { afterEach, describe, expect, it } from "vitest";
import { ConnectorRegistry } from "./registry";
import { registerBuiltinConnectors } from "./builtins";

const originalHosts = process.env.SABAH_WEBHOOK_ALLOWED_HOSTS;
afterEach(() => {
  if (originalHosts === undefined) delete process.env.SABAH_WEBHOOK_ALLOWED_HOSTS;
  else process.env.SABAH_WEBHOOK_ALLOWED_HOSTS = originalHosts;
});

describe("built-in connectors", () => {
  it("registers the real signed webhook identity and draft-only boundaries", async () => {
    process.env.SABAH_WEBHOOK_ALLOWED_HOSTS = "hooks.example.test";
    const registry = new ConnectorRegistry();
    registerBuiltinConnectors(registry);

    const definition = registry.resolve("sabah.webhook", "1.0.0");
    expect(definition).toMatchObject({
      key: "sabah.webhook",
      version: "1.0.0",
      storedVersion: 1,
      kind: "webhook",
      direction: "BIDIRECTIONAL",
      dataPolicy: "INTERNAL",
      dataClassification: "INTERNAL",
      enabled: true,
      supportedCapabilities: ["tasks.create"],
    });
    expect(definition.supportedEvents).toEqual([
      "workflow.planned",
      "approval.requested",
      "step.completed",
      "step.failed",
      "memory.proposed",
      "playbook.proposed",
    ]);
    expect(definition.configSchema.safeParse({ host: "hooks.example.test", path: "/sabah" }).success).toBe(true);
    expect(definition.credentialSchema.safeParse("a-bounded-secret").success).toBe(true);
    expect(await definition.outbound?.({ name: "step.completed", payload: { task: "draft" } })).toMatchObject({ kind: "delivery_request", draftOnly: true });
    expect(await definition.inbound?.({ name: "step.completed", payload: { task: "draft" } })).toMatchObject({ kind: "inbound_suggestion", draftOnly: true });
  });

  it("is idempotent and fails closed at configuration boundaries", () => {
    process.env.SABAH_WEBHOOK_ALLOWED_HOSTS = "hooks.example.test";
    const registry = new ConnectorRegistry();
    registerBuiltinConnectors(registry);
    registerBuiltinConnectors(registry);
    const definition = registry.resolve("sabah.webhook", "1.0.0");

    expect(registry.list()).toHaveLength(1);
    expect(definition.configSchema.safeParse({ host: "other.example.test", path: "/sabah" }).success).toBe(false);
    expect(definition.configSchema.safeParse({ host: "hooks.example.test", path: "https://evil.test" }).success).toBe(false);
    expect(definition.configSchema.safeParse({ host: "hooks.example.test", path: "/sabah", token: "nope" }).success).toBe(false);
    expect(definition.credentialSchema.safeParse("").success).toBe(false);
    delete process.env.SABAH_WEBHOOK_ALLOWED_HOSTS;
    expect(definition.configSchema.safeParse({ host: "hooks.example.test", path: "/sabah" }).success).toBe(false);
  });
});
