import { describe, expect, it, vi } from "vitest";
const assertVisible = vi.hoisted(() => vi.fn(async () => ({ id: "sr-1", status: "Open", claimedById: null })));
vi.mock("@/lib/support/commands", () => ({ assertSupportRequestVisible: assertVisible, claimSupportRequest: vi.fn(), createSupportRequest: vi.fn(), listSupportForActor: vi.fn() }));
import { SUPPORT_CAPABILITIES, registerSupportCapabilities } from "./support";

describe("support capabilities", () => {
  it("registers exactly search, create, and claim", () => {
    expect(SUPPORT_CAPABILITIES.map((capability) => capability.name)).toEqual(["support.search", "support.create", "support.claim"]);
    expect(SUPPORT_CAPABILITIES.some((capability) => capability.name.includes("delete"))).toBe(false);
    const registry = { register: () => undefined };
    expect(() => registerSupportCapabilities(registry as any)).not.toThrow();
  });

  it("describes privacy-safe notification recipients in the create preview", async () => {
    const create = SUPPORT_CAPABILITIES.find((capability) => capability.name === "support.create")!;
    const preview = await create.preview({ title: "Need help" } as any, { actor: { id: "u-1", role: "MEMBER" } } as any);
    const audience = preview.fields.find((field: any) => field.path === "notificationAudience");
    expect(audience?.proposed).toContain("can view all linked entities");
    expect(audience?.proposed).not.toContain("all project members");
  });

  it("uses the claim input id in the preview entity link", async () => {
    const claim = SUPPORT_CAPABILITIES.find((capability) => capability.name === "support.claim")!;
    const preview = await claim.preview({ id: "sr-1" } as any, { actor: { id: "u-1", role: "MEMBER" } } as any);
    expect(preview.fields).toEqual(expect.arrayContaining([expect.objectContaining({ path: "id", proposed: "sr-1" })]));
    expect(preview.fields).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: "supportRequestId" })]));
  });
  it("rejects viewer claim previews before reading", async () => {
    const claim = SUPPORT_CAPABILITIES.find((capability) => capability.name === "support.claim")!;
    await expect(claim.preview({ id: "sr-1" } as any, { actor: { id: "u-1", role: "VIEWER" } } as any)).rejects.toMatchObject({ status: 403 });
  });
  it("rejects an inaccessible claim preview without writing", async () => {
    assertVisible.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404, code: "NOT_FOUND" }));
    const claim = SUPPORT_CAPABILITIES.find((capability) => capability.name === "support.claim")!;
    await expect(claim.preview({ id: "private" } as any, { actor: { id: "u-1", role: "MEMBER" } } as any)).rejects.toMatchObject({ status: 404 });
  });

});
