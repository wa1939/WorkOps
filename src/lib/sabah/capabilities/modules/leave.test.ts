import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../registry";
import { LEAVE_CAPABILITY_NAMES, registerLeaveCapabilities } from "./leave";

describe("leave capabilities", () => {
  it("registers exactly the reviewed surface", () => { const r = new CapabilityRegistry(); registerLeaveCapabilities(r); expect(LEAVE_CAPABILITY_NAMES).toEqual(["leave.searchMine", "leave.getMine", "leave.draft", "leave.create", "leave.updateHandover", "leave.prepareReturnReport"]); expect(r.resolve("leave.create").requiresExplicitApproval).toBe(true); });
  it("makes writes unavailable to viewers", async () => { const r = new CapabilityRegistry(); registerLeaveCapabilities(r); const c = r.resolve("leave.create"); await expect(c.available({ id: "v", role: "VIEWER", departmentIds: [] })).resolves.toBe(false); });
});
