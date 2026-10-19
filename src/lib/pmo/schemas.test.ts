import { describe, expect, it } from "vitest";
import {
    evidenceSchema,
    externalActionCreateSchema,
    externalActionUpdateSchema,
    lifecycleSchema,
    markFollowUpSentSchema,
    responseSchema,
} from "./schemas";

const validAction = {
    title: "Submit engagement evidence",
    description: "Provide the approved report",
    ownerId: "owner",
    externalContactId: "contact",
    dueDate: "2026-08-12",
    projectId: "project",
    caseStudyId: null,
    reminderOffsets: [30, 7, 0],
    overdueIntervalDays: 7,
};

describe("externalActionCreateSchema", () => {
    it("requires exactly one parent", () => {
        expect(externalActionCreateSchema.safeParse(validAction).success).toBe(
            true,
        );
        expect(
            externalActionCreateSchema.safeParse({
                ...validAction,
                caseStudyId: "case",
            }).success,
        ).toBe(false);
        expect(
            externalActionCreateSchema.safeParse({
                ...validAction,
                projectId: null,
            }).success,
        ).toBe(false);
    });

    it("uses calendar-date strings for due dates", () => {
        expect(
            externalActionCreateSchema.safeParse({
                ...validAction,
                dueDate: "2026-8-12",
            }).success,
        ).toBe(false);
        expect(
            externalActionCreateSchema.safeParse({
                ...validAction,
                dueDate: "2026-08-12T00:00:00Z",
            }).success,
        ).toBe(false);
    });

    it("accepts only supported priorities", () => {
        expect(
            externalActionCreateSchema.safeParse({
                ...validAction,
                priority: "CRITICAL",
            }).success,
        ).toBe(false);
    });

    it("requires unique integer reminder offsets from 0 through 365", () => {
        for (const reminderOffsets of [[7, 7], [-1], [366], [1.5]]) {
            expect(
                externalActionCreateSchema.safeParse({
                    ...validAction,
                    reminderOffsets,
                }).success,
            ).toBe(false);
        }
    });

    it("allows null or 1 through 90 for the overdue interval", () => {
        expect(
            externalActionCreateSchema.safeParse({
                ...validAction,
                overdueIntervalDays: null,
            }).success,
        ).toBe(true);
        for (const overdueIntervalDays of [0, 91, 1.5]) {
            expect(
                externalActionCreateSchema.safeParse({
                    ...validAction,
                    overdueIntervalDays,
                }).success,
            ).toBe(false);
        }
    });

    it("requires unique nonblank collaborator IDs", () => {
        expect(
            externalActionCreateSchema.safeParse({
                ...validAction,
                collaboratorIds: ["collaborator", "collaborator"],
            }).success,
        ).toBe(false);
        expect(
            externalActionCreateSchema.safeParse({
                ...validAction,
                collaboratorIds: [""],
            }).success,
        ).toBe(false);
    });
});

describe("externalActionUpdateSchema", () => {
    it("accepts optional editable fields", () => {
        expect(
            externalActionUpdateSchema.safeParse({
                title: "Updated action",
                collaboratorIds: ["one", "two"],
            }).success,
        ).toBe(true);
    });

    it.each([null, 1, 90])(
        "accepts overdue interval boundary value %s",
        (overdueIntervalDays) => {
            expect(
                externalActionUpdateSchema.safeParse({ overdueIntervalDays })
                    .success,
            ).toBe(true);
        },
    );

    it.each([0, 91])(
        "rejects overdue interval boundary value %s",
        (overdueIntervalDays) => {
            expect(
                externalActionUpdateSchema.safeParse({ overdueIntervalDays })
                    .success,
            ).toBe(false);
        },
    );

    it("rejects private visibility and direct terminal transitions", () => {
        expect(
            externalActionUpdateSchema.safeParse({ isPrivate: true }).success,
        ).toBe(false);
        expect(
            externalActionUpdateSchema.safeParse({ status: "DONE" }).success,
        ).toBe(false);
        expect(
            externalActionUpdateSchema.safeParse({ status: "CANCELED" }).success,
        ).toBe(false);
    });

    it("requires unique collaborator IDs", () => {
        expect(
            externalActionUpdateSchema.safeParse({
                collaboratorIds: ["same", "same"],
            }).success,
        ).toBe(false);
    });
});

describe("evidenceSchema", () => {
    it("accepts only absolute HTTPS evidence URLs", () => {
        expect(
            evidenceSchema.safeParse({
                label: "Signed report",
                url: "https://tenant.sharepoint.com/file",
            }).success,
        ).toBe(true);
        for (const url of [
            "http://example.com/file",
            "/relative/file",
            "ftp://example.com/file",
        ]) {
            expect(
                evidenceSchema.safeParse({ label: "Signed report", url }).success,
            ).toBe(false);
        }
    });
});

describe("responseSchema", () => {
    it("requires a comment and validates optional evidence", () => {
        expect(responseSchema.safeParse({ comment: "Received" }).success).toBe(
            true,
        );
        expect(responseSchema.safeParse({ comment: "   " }).success).toBe(false);
        expect(
            responseSchema.safeParse({
                comment: "Received",
                evidence: {
                    label: "Report",
                    url: "http://example.com/report",
                },
            }).success,
        ).toBe(false);
    });
});

describe("lifecycleSchema", () => {
    it("requires a nonblank cancellation reason", () => {
        expect(
            lifecycleSchema.safeParse({
                action: "cancel",
                reason: "No longer required",
            }).success,
        ).toBe(true);
        expect(
            lifecycleSchema.safeParse({ action: "cancel", reason: "   " })
                .success,
        ).toBe(false);
    });

    it("accepts close and reopen lifecycle actions", () => {
        expect(lifecycleSchema.safeParse({ action: "close" }).success).toBe(true);
        expect(lifecycleSchema.safeParse({ action: "reopen" }).success).toBe(
            true,
        );
    });
});

describe("markFollowUpSentSchema", () => {
    it("requires recipient, subject, and body payload fields", () => {
        expect(
            markFollowUpSentSchema.safeParse({
                eventId: "event",
                confirmedSent: true,
                recipient: "contact@example.com",
                subject: "Action reminder",
                body: "Please provide the requested evidence.",
            }).success,
        ).toBe(true);
        expect(
            markFollowUpSentSchema.safeParse({
                confirmedSent: true,
                recipient: "contact@example.com",
                subject: "Manual action reminder",
                body: "Please provide the requested evidence.",
            }).success,
        ).toBe(true);
        expect(
            markFollowUpSentSchema.safeParse({
                eventId: "event",
                confirmedSent: false,
                recipient: "contact@example.com",
                subject: "Action reminder",
                body: "Please provide the requested evidence.",
            }).success,
        ).toBe(false);
        expect(
            markFollowUpSentSchema.safeParse({
                recipient: "not-an-email",
                subject: "Action reminder",
                body: "Please provide the requested evidence.",
            }).success,
        ).toBe(false);
    });
});
