import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { learningJsonError, projectLearningRecord } from "@/lib/sabah/capabilities/modules/learning";

describe("learning route contracts", () => {
  it("maps malformed input to bounded 400 and masks sensitive record fields", () => {
    expect(learningJsonError({ code: "INVALID_INPUT" })).toMatchObject({ status: 400 });
    expect(projectLearningRecord({ id: "m1", scope: "USER", kind: "FACT", content: "fact", provenance: "USER_PROVIDED", confidence: 0.5, freshness: "FRESH", expiresAt: null, ownerId: "u1", departmentId: null, state: "PROPOSED", sources: [{ checksum: "secret", entityId: "n1", entityType: "NOTE", label: "Note", href: "/n1", sourceUpdatedAt: "2026-08-01T00:00:00.000Z" }], approval: { actorId: "u1", reason: "secret", at: new Date() } } as unknown)).toMatchObject({ id: "m1", content: "fact", sources: [{ entityType: "NOTE", entityId: "n1", label: "Note", href: "/n1", checksum: "secret", sourceUpdatedAt: "2026-08-01T00:00:00.000Z" }] });
  });

  it("forwards the explicit shared approval policy to the memory decision route", () => {
    const route = readFileSync(new URL("./memory/[id]/decision/route.ts", import.meta.url), "utf8");
    expect(route).toMatch(/canApproveSharedScope:\s*deps\.sharedMemoryApprovalPolicy\s*\?\?\s*deps\.sharedMemoryPolicy/);
  });

  it("projects only safe approved-memory provenance and source fields", () => {
    const projected = projectLearningRecord({ id: "m1", scope: "USER", kind: "FACT", content: "fact", provenance: "IMPORTED", confidence: 0.5, freshness: "FRESH", expiresAt: null, ownerId: "u1", departmentId: null, state: "APPROVED", sources: [{ checksum: "abc123", entityId: "n1", entityType: "NOTE", label: "Note", href: "/notes/n1", sourceUpdatedAt: "2026-08-01T00:00:00.000Z" }], approval: { actorId: "u1", reason: "private", at: new Date() }, audit: "private", providerPayload: "secret" } as unknown);
    expect(projected).toMatchObject({ provenance: "IMPORTED", sources: [{ entityType: "NOTE", entityId: "n1", href: "/notes/n1", sourceUpdatedAt: "2026-08-01T00:00:00.000Z" }] });
    expect(projected).not.toHaveProperty("approval");
    expect(projected).not.toHaveProperty("audit");
    expect(projected).not.toHaveProperty("providerPayload");
  });

  it("rejects unsafe memory source projections", () => {
    expect(projectLearningRecord({ id: "m1", scope: "USER", kind: "FACT", content: "fact", provenance: "SYSTEM", confidence: 0.5, freshness: "FRESH", expiresAt: null, ownerId: "u1", departmentId: null, state: "APPROVED", sources: [{ checksum: "abc123", entityId: "n1", entityType: "NOTE", label: "Note", href: "//evil.example", sourceUpdatedAt: "2026-08-01T00:00:00.000Z" }] } as unknown)).toBeNull();
  });
});
