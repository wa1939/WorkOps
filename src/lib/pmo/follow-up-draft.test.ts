import { describe, expect, it } from "vitest";
import { buildAiRewritePrompt, buildFollowUpDraft, parseAiRewrite, selectScheduledDraftEvent } from "./follow-up-draft";
const input = { contactName: "Ahmed", contactEmail: "ahmed@example.com", actionTitle: "Submit survey evidence", actionDescription: "Provide the final signed response", parentType: "Project" as const, parentName: "Engagement Survey", dueDate: "12 Aug 2026" };
describe("follow-up drafts", () => {
    it("builds the required standard draft", () => { const draft = buildFollowUpDraft(input); expect(draft.to).toBe("ahmed@example.com"); expect(draft.subject).toBe("Follow-up: Submit survey evidence - due 12 Aug 2026"); expect(draft.body).toContain("Provide the final signed response"); expect(draft.body).toContain("evidence or deliverable link"); });
    it("never puts the recipient email in the AI prompt", () => { const draft = buildFollowUpDraft(input); expect(buildAiRewritePrompt(draft, { actionTitle: input.actionTitle, parentName: input.parentName, dueDate: input.dueDate })).not.toContain("ahmed@example.com"); });
    it("parses the strict subject/body response", () => { expect(parseAiRewrite("SUBJECT: Progress update\nBODY:\nPlease share your update.")).toEqual({ subject: "Progress update", body: "Please share your update." }); });
    it("selects the earliest unsent scheduled event", () => {
        expect(selectScheduledDraftEvent([
            { id: "later", triggerType: "OVERDUE", scheduledDate: new Date("2026-08-02"), sentAt: null },
            { id: "manual", triggerType: "MANUAL", scheduledDate: new Date("2026-07-30"), sentAt: null },
            { id: "sent", triggerType: "DUE", scheduledDate: new Date("2026-07-31"), sentAt: new Date() },
            { id: "next", triggerType: "DUE", scheduledDate: new Date("2026-08-01"), sentAt: null },
        ])?.id).toBe("next");
    });
});
