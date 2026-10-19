import { describe, expect, it } from "vitest";
import { assertCapabilityAllowed, HARD_BLOCKED_PATTERNS } from "./hard-boundaries";
import { defineCapability } from "../capabilities/contracts";
import { z } from "zod";

describe("immutable Sabah hard boundaries", () => {
  it.each([
    "admin.roles.update",
    "users.password.reset",
    "auth.session.create",
    "database.query",
    "backup.create",
    "migration.run",
    "production.config.update",
    "tasks.delete",
    "providers.credentials.read",
    "pmo.email.send",
  ])("blocks %s even when absent from the registry", (name) => {
    expect(() => assertCapabilityAllowed(name)).toThrow(/blocked/i);
  });

  it("cannot be weakened by mutating the exported pattern list", () => {
    expect(Object.isFrozen(HARD_BLOCKED_PATTERNS)).toBe(true);
    expect(() => assertCapabilityAllowed("database.query")).toThrow(/blocked/i);
  });

  it("blocks a forbidden definition at its declaration seam", () => {
    expect(() => defineCapability({
      name: "backup.create",
      version: 1,
      module: "backup",
      description: "backup",
      risk: "BLOCKED",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      available: async () => true,
      authorize: async () => {},
      preview: async () => ({ title: "", fields: [] }),
      execute: async () => ({}),
      verify: async (output) => output,
      summarize: () => "",
    })).toThrow(/blocked/i);
  });

  it.each(["productionConfig.update", "accessControl.update", "admin.rolesUpdate"])(
      "blocks forbidden camelCase capability fragments: %s",
      (name) => {
        expect(() => assertCapabilityAllowed(name)).toThrow(/blocked/i);
      },
    );

    it.each(["task.update", "project_456", "safe-draft.run"])("keeps ordinary IDs allowed: %s", (name) => {
      expect(() => assertCapabilityAllowed(name)).not.toThrow();
    });
    });
