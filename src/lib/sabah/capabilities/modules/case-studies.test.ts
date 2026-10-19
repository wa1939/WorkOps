import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canUpdateCaseStudy: vi.fn(async (id: string, actor: { id: string; role: string }) => id === "cs1" && ["u1", "u2", "admin"].includes(actor.id) && actor.role !== "VIEWER"),
}));
vi.mock("@/lib/case-studies/authorization", () => ({ canUpdateCaseStudy: mocks.canUpdateCaseStudy }));

import { CASE_STUDY_CAPABILITY_NAMES, caseStudiesPlanTasksCapability, caseStudiesUpdateCapability } from "./case-studies";

const updateInput = { id: "cs1", name: "Changed", expectedUpdatedAt: "2026-08-24T00:00:00.000Z" };
const context = (id: string, role = "MEMBER") => ({ actor: { id, role, departmentIds: [] } } as any);

describe("case study capabilities", () => {
  it("exposes exactly the reviewed names and no delete", () => expect(CASE_STUDY_CAPABILITY_NAMES).toEqual(["caseStudies.search", "caseStudies.get", "caseStudies.create", "caseStudies.update", "caseStudies.planTasks"]));

  it.each([["owner", "u1"], ["member", "u2"], ["Admin", "admin"]])("authorizes %s updates using command policy", async (_label, actorId) => {
    await expect(caseStudiesUpdateCapability.authorize(updateInput, context(actorId))).resolves.toBeUndefined();
    expect(mocks.canUpdateCaseStudy).toHaveBeenCalledWith("cs1", expect.objectContaining({ id: actorId }));
  });

  it("rejects a non-owner non-member at capability authorization", async () => {
    await expect(caseStudiesUpdateCapability.authorize(updateInput, context("outsider"))).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("rejects Viewer updates even when the command policy mock would allow the record", async () => {
    await expect(caseStudiesUpdateCapability.authorize(updateInput, context("u1", "VIEWER"))).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("previews task planning as downstream tasks.create steps", async () => {
    const preview = await caseStudiesPlanTasksCapability.preview({ caseStudyId: "cs1", tasks: [{ title: "A" }], allowPartial: false }, {} as any);
    expect(preview.fields).toEqual(expect.arrayContaining([{ path: "downstreamWrites", proposed: "0 (review required)" }]));
  });
});
