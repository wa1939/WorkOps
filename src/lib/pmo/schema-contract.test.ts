import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const hardeningMigration = readFileSync(
    "prisma/migrations/20260715230000_harden_pmo_delivery_and_constraints/migration.sql",
    "utf8",
);

describe("PMO Prisma contract", () => {
    it.each(["TaskType", "FollowUpTrigger", "EmailDeliveryState"])("defines enum %s", (name) => {
        expect(schema).toContain(`enum ${name} {`);
    });

    it.each(["WorkArea", "ExternalContact", "ExternalAction", "ReminderRule", "FollowUpEvent", "ActionEvidence"])(
        "defines model %s",
        (name) => expect(schema).toContain(`model ${name} {`),
    );

    it("keeps existing tasks standard and PMO actions public", () => {
        expect(schema).toMatch(/type\s+TaskType\s+@default\(STANDARD\)/);
        expect(schema).toMatch(/externalAction\s+ExternalAction\?/);
    });

    it("preserves legacy saved-view fields with additive defaults", () => {
        expect(schema).toMatch(/entity\s+String\?/);
        expect(schema).toMatch(/viewType\s+String\?/);
        expect(schema).toMatch(/query\s+String\?/);
        expect(schema).toMatch(/blocksJson\s+String\s+@default\("\[\]"\)\s+@db\.Text/);
        expect(schema).toMatch(/updatedAt\s+DateTime\s+@default\(now\(\)\)\s+@updatedAt/);
    });

    it("links follow-up events to notifications, not generic task reminders", () => {
        const notification = schema.match(/model Notification \{([\s\S]*?)\n\}/)?.[1];
        const taskReminder = schema.match(/model TaskReminder \{([\s\S]*?)\n\}/)?.[1];
        expect(notification).toMatch(/followUpEvent\s+FollowUpEvent\?/);
        expect(taskReminder).not.toMatch(/followUpEvent/);
    });

    it("persists provider delivery identity without adding unrelated lifecycle fields", () => {
        expect(schema).toMatch(/ownerEmailProviderId\s+String\?/);
        expect(schema).not.toMatch(/cancellationReason\s+String\?/);
    });

    it("adds production-safe conditional checks that preserve ordinary tasks", () => {
        expect(hardeningMigration).toContain('ADD COLUMN "ownerEmailProviderId" TEXT');
        expect(hardeningMigration).toContain('"type" <> \'EXTERNAL_ACTION\'');
        expect(hardeningMigration).toContain('"dueAt" IS NOT NULL');
        expect(hardeningMigration).toContain('"isPrivate" = false');
        expect(hardeningMigration).toContain('("projectId" IS NOT NULL) <> ("caseStudyId" IS NOT NULL)');
        expect(hardeningMigration.match(/NOT VALID/g)).toHaveLength(3);
        expect(hardeningMigration.match(/VALIDATE CONSTRAINT/g)).toHaveLength(3);
        expect(hardeningMigration).not.toMatch(/DROP|DELETE|TRUNCATE/i);
    });
});
