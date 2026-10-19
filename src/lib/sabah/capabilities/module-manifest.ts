export type OperationalModule =
    | "pmo"
    | "notes"
    | "leave"
    | "caseStudies"
    | "reports"
    | "support"
    | "savedViews"
    | "notifications"
    | "team";

export type OperationalModuleManifestItem = {
    module: OperationalModule;
    capabilities: readonly string[];
    sourceRoutes: readonly string[];
    formSurfaces: readonly string[];
    ownerTask: `Task ${2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;
    plan: "2026-08-24-sabah-operational-parity";
};

/**
 * Reviewed operational allowlist for Sabah.
 *
 * Keep this list static: Task 10 binds these names to registrations and tests
 * that every name resolves. It must not discover routes or import modules.
 */
export const OPERATIONAL_MODULE_MANIFEST: readonly OperationalModuleManifestItem[] = [
    {
        module: "pmo",
        capabilities: [
            "pmo.actions.search",
            "pmo.actions.get",
            "pmo.actions.create",
            "pmo.actions.update",
            "pmo.actions.addEvidence",
            "pmo.actions.addFollowUp",
            "pmo.actions.recordResponse",
            "pmo.actions.changeLifecycle",
            "pmo.contacts.search",
            "pmo.contacts.create",
            "pmo.contacts.update",
            "pmo.workAreas.search",
            "pmo.workAreas.create",
            "pmo.workAreas.update",
            "pmo.drafts.generate",
            "pmo.drafts.rewrite",
        ],
        sourceRoutes: [
            "src/lib/pmo/action-service.ts",
            "src/lib/pmo/lifecycle-service.ts",
            "src/lib/pmo/follow-up-service.ts",
            "src/lib/pmo/authorization.ts",
            "src/app/api/pmo/actions/**/route.ts",
            "src/app/api/pmo/contacts/**/route.ts",
            "src/app/api/pmo/work-areas/**/route.ts",
        ],
        formSurfaces: [
            "src/app/(app)/pmo/actions/new/page.tsx",
            "src/app/(app)/pmo/actions/[taskId]/edit/page.tsx",
            "src/app/(app)/pmo/portfolio/page.tsx",
            "src/app/(app)/pmo/settings/page.tsx",
        ],
        ownerTask: "Task 2",
        plan: "2026-08-24-sabah-operational-parity",
    },
    {
        module: "notes",
        capabilities: [
            "notes.search",
            "notes.get",
            "notes.create",
            "notes.update",
            "notes.summarize",
            "notes.convertToActions",
        ],
        sourceRoutes: [
            "src/app/api/notes/route.ts",
            "src/app/api/notes/[id]/route.ts",
        ],
        formSurfaces: [
            "src/app/(app)/notes/new/page.tsx",
            "src/app/(app)/notes/[id]/edit/page.tsx",
            "src/app/(app)/notes/[id]/page.tsx",
        ],
        ownerTask: "Task 3",
        plan: "2026-08-24-sabah-operational-parity",
    },
    {
        module: "leave",
        capabilities: [
            "leave.searchMine",
            "leave.getMine",
            "leave.draft",
            "leave.create",
            "leave.updateHandover",
            "leave.prepareReturnReport",
        ],
        sourceRoutes: [
            "src/app/api/leave/route.ts",
            "src/app/api/leave/[id]/route.ts",
            "src/app/api/leave/[id]/handover/route.ts",
        ],
        formSurfaces: [
            "src/app/(app)/leave/new/page.tsx",
            "src/app/(app)/leave/[id]/edit/page.tsx",
            "src/app/(app)/leave/[id]/return-report/page.tsx",
        ],
        ownerTask: "Task 4",
        plan: "2026-08-24-sabah-operational-parity",
    },
    {
        module: "caseStudies",
        capabilities: [
            "caseStudies.search",
            "caseStudies.get",
            "caseStudies.create",
            "caseStudies.update",
            "caseStudies.planTasks",
        ],
        sourceRoutes: [
            "src/app/api/case-studies/route.ts",
            "src/app/api/case-studies/[id]/route.ts",
        ],
        formSurfaces: [
            "src/app/(app)/case-studies/new/page.tsx",
            "src/app/(app)/case-studies/[id]/page.tsx",
        ],
        ownerTask: "Task 5",
        plan: "2026-08-24-sabah-operational-parity",
    },
    {
        module: "reports",
        capabilities: [
            "reports.search",
            "reports.get",
            "reports.generateDraft",
            "reports.enhance",
            "reports.compare",
            "reports.finalize",
        ],
        sourceRoutes: [
            "src/app/api/weekly-reports/[id]/route.ts",
            "src/app/api/reports/ai-enhance/route.ts",
            "src/app/api/reports/[id]/final/route.ts",
        ],
        formSurfaces: [
            "src/app/(app)/reports/page.tsx",
            "src/app/(app)/reports/[id]/page.tsx",
        ],
        ownerTask: "Task 6",
        plan: "2026-08-24-sabah-operational-parity",
    },
    {
        module: "support",
        capabilities: ["support.search", "support.create", "support.claim"],
        sourceRoutes: [
            "src/app/api/support/route.ts",
            "src/app/api/support/[id]/claim/route.ts",
        ],
        formSurfaces: ["src/app/(app)/support/page.tsx"],
        ownerTask: "Task 7",
        plan: "2026-08-24-sabah-operational-parity",
    },
    {
        module: "savedViews",
        capabilities: [
            "savedViews.search",
            "savedViews.create",
            "savedViews.update",
            "savedViews.vote",
        ],
        sourceRoutes: [
            "src/app/api/saved-views/route.ts",
            "src/app/api/saved-views/[id]/route.ts",
            "src/app/api/saved-views/[id]/vote/route.ts",
        ],
        formSurfaces: [
            "src/app/(app)/views/new/page.tsx",
            "src/app/(app)/views/[id]/edit/page.tsx",
            "src/app/(app)/views/[id]/page.tsx",
            "src/components/layout/saved-views-list.tsx",
        ],
        ownerTask: "Task 8",
        plan: "2026-08-24-sabah-operational-parity",
    },
    {
        module: "notifications",
        capabilities: [
            "notifications.listMine",
            "notifications.markRead",
            "notifications.markAllRead",
            "notifications.summarize",
        ],
        sourceRoutes: [
            "src/app/api/notifications/route.ts",
            "src/app/api/notifications/[id]/read/route.ts",
            "src/app/api/notifications/read-all/route.ts",
        ],
        formSurfaces: [
            "src/components/notification-bell.tsx",
            "src/components/notification-snooze.tsx",
        ],
        ownerTask: "Task 8",
        plan: "2026-08-24-sabah-operational-parity",
    },
    {
        module: "team",
        capabilities: [
            "team.members",
            "team.capacity",
            "team.assignmentCandidates",
            "team.proposeRebalance",
        ],
        sourceRoutes: ["src/lib/team-load.ts"],
        formSurfaces: ["src/app/(app)/team/page.tsx"],
        ownerTask: "Task 9",
        plan: "2026-08-24-sabah-operational-parity",
    },
] as const;
