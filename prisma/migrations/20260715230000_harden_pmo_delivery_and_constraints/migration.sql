-- Persist the Resend delivery identity returned for each owner reminder.
ALTER TABLE "FollowUpEvent"
ADD COLUMN "ownerEmailProviderId" TEXT;

-- External actions require a due date. Ordinary tasks are unaffected.
ALTER TABLE "Task"
ADD CONSTRAINT "Task_external_action_dueAt_check"
CHECK ("type" <> 'EXTERNAL_ACTION' OR "dueAt" IS NOT NULL) NOT VALID;

-- External actions are always team-visible. Ordinary tasks may remain private.
ALTER TABLE "Task"
ADD CONSTRAINT "Task_external_action_public_check"
CHECK ("type" <> 'EXTERNAL_ACTION' OR "isPrivate" = false) NOT VALID;

-- External actions belong to exactly one supported PMO parent.
ALTER TABLE "Task"
ADD CONSTRAINT "Task_external_action_parent_check"
CHECK ("type" <> 'EXTERNAL_ACTION' OR (("projectId" IS NOT NULL) <> ("caseStudyId" IS NOT NULL))) NOT VALID;

ALTER TABLE "Task" VALIDATE CONSTRAINT "Task_external_action_dueAt_check";
ALTER TABLE "Task" VALIDATE CONSTRAINT "Task_external_action_public_check";
ALTER TABLE "Task" VALIDATE CONSTRAINT "Task_external_action_parent_check";
