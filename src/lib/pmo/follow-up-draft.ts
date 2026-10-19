export type FollowUpDraft = { to: string; subject: string; body: string };
export type DraftInput = {
    contactName: string;
    contactEmail: string;
    actionTitle: string;
    actionDescription: string;
    parentType: "Project" | "Case Study";
    parentName: string;
    dueDate: string;
};

type ScheduledEvent = {
    id: string;
    triggerType: string;
    scheduledDate: Date;
    sentAt: Date | null;
};

export function selectScheduledDraftEvent(events: ScheduledEvent[]): ScheduledEvent | null {
    return events
        .filter((event) => event.triggerType !== "MANUAL" && !event.sentAt)
        .sort((left, right) => left.scheduledDate.getTime() - right.scheduledDate.getTime())[0] ?? null;
}

export function buildFollowUpDraft(input: DraftInput): FollowUpDraft {
    return {
        to: input.contactEmail,
        subject: `Follow-up: ${input.actionTitle} - due ${input.dueDate}`,
        body: [
            `Dear ${input.contactName},`,
            "",
            "I am following up on the action we agreed:",
            input.actionDescription,
            "",
            `${input.parentType}: ${input.parentName}`,
            `Due date: ${input.dueDate}`,
            "",
            "Please share a brief progress update. If the action is complete, please include the evidence or deliverable link so we can close it in our tracker.",
            "",
            "Thank you,",
        ].join("\n"),
    };
}

export function buildAiRewritePrompt(
    draft: FollowUpDraft,
    context: { actionTitle: string; parentName: string; dueDate: string },
): string {
    return [
        "Rewrite this follow-up professionally without inventing progress or completion.",
        "Return exactly SUBJECT: followed by one line, then BODY: followed by the body.",
        `Action: ${context.actionTitle}`,
        `Parent: ${context.parentName}`,
        `Due: ${context.dueDate}`,
        `Current subject: ${draft.subject}`,
        "Current body:",
        draft.body,
    ].join("\n");
}

export function parseAiRewrite(raw: string): Pick<FollowUpDraft, "subject" | "body"> {
    const match = raw.match(/^SUBJECT:\s*(.+)\r?\nBODY:\s*\r?\n?([\s\S]+)$/i);
    const subject = match?.[1]?.trim();
    const body = match?.[2]?.trim();
    if (!subject || !body) throw new Error("AI rewrite must contain non-blank SUBJECT and BODY markers");
    return { subject, body };
}
