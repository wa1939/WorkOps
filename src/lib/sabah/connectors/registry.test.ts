import { describe, expect, it } from "vitest";
import { ConnectorRegistry } from "./registry";
import { decryptConnectorCredential, encryptConnectorCredential } from "./crypto";
import type { ConnectorDefinition } from "./contracts";
import { z } from "zod";

const definition = (overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition => ({
  key: "acme.tasks",
  version: "1.0.0",
  storedVersion: 1,
  supportedEvents: ["step.completed"],
  supportedCapabilities: ["tasks.read"],
  direction: "OUTBOUND",
  configSchema: z.object({ project: z.string() }).strict(),
  credentialSchema: z.object({ token: z.string().min(1) }).strict(),
  dataClassification: "INTERNAL",
  enabled: true,
  outbound: async () => undefined,
  ...overrides,
});

describe("ConnectorRegistry", () => {
  it("registers and resolves exact key/version deterministically", () => {
    const registry = new ConnectorRegistry();
    registry.register(definition());
    expect(registry.resolve("acme.tasks", "1.0.0")).toBeDefined();
    expect(registry.resolveStoredVersion("acme.tasks", 1)).toBeDefined();
    expect(registry.resolveStoredVersion("acme.tasks", 2)).toBeNull();
    expect(registry.list()).toHaveLength(1);
    expect(() => registry.register(definition())).toThrow();
  });

  it("rejects unsupported names, malformed identity, arbitrary URLs, and invalid handlers", () => {
    const registry = new ConnectorRegistry();
    expect(() => registry.register(definition({ key: "bad key" }))).toThrow();
    expect(() => registry.register(definition({ version: "latest" }))).toThrow();
    expect(() => registry.register(definition({ supportedEvents: ["nope"] as unknown as ConnectorDefinition["supportedEvents"] }))).toThrow();
    expect(() => registry.register(definition({ endpoint: "https://example.test" }))).toThrow();
    expect(() => registry.register(definition({ outbound: "not-a-handler" as unknown as ConnectorDefinition["outbound"] }))).toThrow();
  });

  it("enforces direction, schemas, allowlists, and disabled delivery", async () => {
    const inbound = async () => undefined;
    const registry = new ConnectorRegistry();
    registry.register(definition({ direction: "BIDIRECTIONAL", inbound }));
    await expect(registry.validateConfig("acme.tasks", "1.0.0", { project: "x" })).resolves.toEqual({ project: "x" });
    await expect(registry.validateCredentials("acme.tasks", "1.0.0", { token: "x" })).resolves.toEqual({ token: "x" });
    await expect(registry.validateConfig("acme.tasks", "1.0.0", { wrong: true })).rejects.toThrow();
    const disabled = new ConnectorRegistry();
    disabled.register(definition({ enabled: false }));
    await expect(disabled.deliver("acme.tasks", "1.0.0", { name: "step.completed" })).rejects.toThrow();
  });

  it("round-trips connector credentials without exposing plaintext", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptConnectorCredential("sensitive", key, { connectorKey: "acme.tasks", keyVersion: 2 });
    expect(encrypted).not.toContain("sensitive");
    expect(decryptConnectorCredential(encrypted, key)).toBe("sensitive");
  });

  it("rejects malformed encrypted records before decryption", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptConnectorCredential("sensitive", key, { connectorKey: "acme.tasks" });
    Object.defineProperty(encrypted, "iv", { value: "not-base64" });
    expect(() => decryptConnectorCredential(encrypted, key)).toThrow();
    const malformedKey = encryptConnectorCredential("sensitive", key, { connectorKey: "acme.tasks" });
    Object.defineProperty(malformedKey, "connectorKey", { value: "bad key" });
    expect(() => decryptConnectorCredential(malformedKey, key)).toThrow();
  });
});
