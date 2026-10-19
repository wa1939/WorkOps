import { describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const generateDraftForPeriod = vi.fn();
const enhanceReport = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/reports/commands", () => ({ enhanceReport: (...args: unknown[]) => enhanceReport(...args), generateDraftForPeriod: (...args: unknown[]) => generateDraftForPeriod(...args) }));

import { POST } from "./route";

describe("POST /api/reports/ai-enhance", () => {
  it("adapts the real period command while preserving the public response shape", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "MANAGER" } });
    generateDraftForPeriod.mockResolvedValue({ body: "grounded draft", sourceIds: ["t1"], citations: [], draft: true, final: false });
    const response = await POST(new Request("http://localhost/api/reports/ai-enhance", { method: "POST", body: JSON.stringify({ weekStart: "2026-08-01", weekEnd: "2026-08-07" }) }));
    expect(generateDraftForPeriod).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ success: true, aiSummary: "grounded draft" });
  });
});
