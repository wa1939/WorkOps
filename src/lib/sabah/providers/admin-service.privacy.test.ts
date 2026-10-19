import { afterEach, describe, expect, it, vi } from "vitest";
const call = vi.hoisted(() => vi.fn());
vi.mock("@/lib/glm", async (original) => ({ ...await original<typeof import("@/lib/glm")>(), callGLM: call }));
vi.mock("./crypto", () => ({ decryptCredential: () => "synthetic-private-credential", encryptCredential: vi.fn() }));
import { testProviderCredential } from "./admin-service";

const actor = { id: "privacy-test-admin", role: "ADMIN" as const, departmentIds: [] };
const db = { aiProviderCredential: { findUnique: vi.fn(async () => ({ id: "privacy-test-key", providerKey: "zai", isEnabled: true })) } };
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); });
describe("provider credential test response privacy", () => {
  it("does not expose reflected credentials or provider body, and clears its deadline", async () => {
    vi.useFakeTimers();
    call.mockRejectedValue(new Error("API rejected Authorization: Bearer synthetic-private-credential; request=private-source-text"));
    const result = await testProviderCredential(actor, "privacy-test-key", db as never);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic-private-credential");
    expect(JSON.stringify(result)).not.toContain("private-source-text");
    expect(result.error).toBe("Provider test failed. Check credentials and provider availability.");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("returns a safe failure for non-Error throws", async () => {
    vi.useFakeTimers();
    call.mockRejectedValue(null);
    await expect(testProviderCredential(actor, "privacy-test-key", db as never)).resolves.toMatchObject({ success: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});
