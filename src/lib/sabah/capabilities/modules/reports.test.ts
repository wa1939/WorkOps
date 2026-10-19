import { describe, expect, it } from "vitest";
import { vi } from "vitest";
const commandMocks = vi.hoisted(() => ({ get: vi.fn(), compare: vi.fn() }));
vi.mock("@/lib/reports/commands", () => ({ getWeeklyReportForActor: commandMocks.get, compareReportPeriods: commandMocks.compare, searchReports: vi.fn(), enhanceReport: vi.fn(), finalizeReport: vi.fn(), generateDraftForPeriod: vi.fn() }));
import { CapabilityRegistry } from "../registry";
import { REPORT_CAPABILITIES, REPORT_CAPABILITY_NAMES, registerReportCapabilities } from "./reports";

describe("report capabilities", () => {
  it("registers the exact safe surface with no delete/send/publish capability", () => {
    const registry = new CapabilityRegistry(); registerReportCapabilities(registry);
    expect(REPORT_CAPABILITY_NAMES).toEqual(["reports.search", "reports.get", "reports.generateDraft", "reports.enhance", "reports.compare", "reports.finalize"]);
    expect(REPORT_CAPABILITY_NAMES.join(" ")).not.toMatch(/delete|send|publish/i);
    expect(registry.resolve("reports.finalize").requiresExplicitApproval).toBe(true);
  });
  it("keeps generation and enhancement draft-safe", () => {
    expect(REPORT_CAPABILITIES.find((x) => x.name === "reports.generateDraft")?.risk).toBe("DRAFT");
    expect(REPORT_CAPABILITIES.find((x) => x.name === "reports.enhance")?.risk).toBe("DRAFT");
    expect(REPORT_CAPABILITIES.find((x) => x.name === "reports.compare")?.risk).toBe("READ");
  });
  it("only makes finalization available to admins", async () => {
    const cap = REPORT_CAPABILITIES.find((x) => x.name === "reports.finalize")!;
    await expect(cap.available({ id: "m", role: "MEMBER", departmentIds: [] })).resolves.toBe(false);
    await expect(cap.available({ id: "a", role: "ADMIN", departmentIds: [] })).resolves.toBe(true);
  });
  it("checks report visibility, editability, and lifecycle in previews", async () => {
    const memberContext: any = { actor: { id: "m", role: "MEMBER", departmentIds: [] } };
    commandMocks.get.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
    await expect(REPORT_CAPABILITIES.find((x) => x.name === "reports.get")!.preview({ reportId: "private" } as any, memberContext)).rejects.toMatchObject({ status: 404 });
    await expect(REPORT_CAPABILITIES.find((x) => x.name === "reports.enhance")!.preview({ reportId: "r" } as any, memberContext)).rejects.toMatchObject({ status: 403 });
    await expect(REPORT_CAPABILITIES.find((x) => x.name === "reports.finalize")!.preview({ reportId: "r", finalBody: "x", approved: false } as any, memberContext)).rejects.toMatchObject({ status: 403 });
  });
});
