import type { OperationalModule } from "../capabilities/module-manifest";

export type SabahFormClassification =
    | "field-assisted"
    | "chat-context-only"
    | "dedicated-ui-only";

export type SabahFormManifestEntry = {
    id: string;
    module: OperationalModule;
    title: string;
    path: string;
    classification: SabahFormClassification;
    capabilities: readonly string[];
    fields?: readonly string[];
};

/** Static, reviewed inventory of operational forms and adjacent UI surfaces. */
export const SABAH_FORM_MANIFEST: readonly SabahFormManifestEntry[] = [
    {
        id: "pmo-action-create",
        module: "pmo",
        title: "New external action",
        path: "src/app/(app)/pmo/actions/new/page.tsx",
        classification: "field-assisted",
        capabilities: ["pmo.actions.create"],
        fields: ["parent", "title", "description", "ownerId", "externalContactId", "dueDate", "priority", "reminderAt", "overdueIntervalMinutes"],
    },
    {
        id: "pmo-action-edit",
        module: "pmo",
        title: "Edit external action",
        path: "src/app/(app)/pmo/actions/[taskId]/edit/page.tsx",
        classification: "field-assisted",
        capabilities: ["pmo.actions.update", "pmo.actions.changeLifecycle"],
        fields: ["parent", "title", "description", "ownerId", "externalContactId", "dueDate", "priority", "reminderAt", "overdueIntervalMinutes", "status"],
    },
    {
        id: "pmo-portfolio",
        module: "pmo",
        title: "PMO portfolio",
        path: "src/app/(app)/pmo/portfolio/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["pmo.actions.search", "pmo.actions.get"],
    },
    {
        id: "pmo-settings",
        module: "pmo",
        title: "PMO contacts and work areas",
        path: "src/app/(app)/pmo/settings/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["pmo.contacts.search", "pmo.contacts.create", "pmo.contacts.update", "pmo.workAreas.search", "pmo.workAreas.create", "pmo.workAreas.update"],
    },
    {
        id: "notes-create",
        module: "notes",
        title: "New note",
        path: "src/app/(app)/notes/new/page.tsx",
        classification: "chat-context-only",
        capabilities: ["notes.create"],
    },
    {
        id: "notes-edit",
        module: "notes",
        title: "Edit note",
        path: "src/app/(app)/notes/[id]/edit/page.tsx",
        classification: "chat-context-only",
        capabilities: ["notes.update"],
    },
    {
        id: "notes-detail",
        module: "notes",
        title: "Note detail",
        path: "src/app/(app)/notes/[id]/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["notes.get", "notes.summarize", "notes.convertToActions"],
    },
    {
        id: "leave-create",
        module: "leave",
        title: "New leave and handover",
        path: "src/app/(app)/leave/new/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["leave.create", "leave.updateHandover"],
    },
    {
        id: "leave-edit",
        module: "leave",
        title: "Edit leave and handover",
        path: "src/app/(app)/leave/[id]/edit/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["leave.getMine", "leave.updateHandover"],
    },
    {
        id: "leave-return-report",
        module: "leave",
        title: "Prepare return report",
        path: "src/app/(app)/leave/[id]/return-report/page.tsx",
        classification: "chat-context-only",
        capabilities: ["leave.prepareReturnReport"],
    },
    {
        id: "case-studies-create",
        module: "caseStudies",
        title: "New case study",
        path: "src/app/(app)/case-studies/new/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["caseStudies.create"],
    },
    {
        id: "case-studies-detail",
        module: "caseStudies",
        title: "Case study detail",
        path: "src/app/(app)/case-studies/[id]/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["caseStudies.get", "caseStudies.update", "caseStudies.planTasks"],
    },
    {
        id: "reports-list",
        module: "reports",
        title: "Reports",
        path: "src/app/(app)/reports/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["reports.search", "reports.generateDraft"],
    },
    {
        id: "reports-detail",
        module: "reports",
        title: "Report detail and finalization",
        path: "src/app/(app)/reports/[id]/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["reports.get", "reports.enhance", "reports.compare", "reports.finalize"],
    },
    {
        id: "support-dashboard",
        module: "support",
        title: "Support requests",
        path: "src/app/(app)/support/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["support.search", "support.claim"],
    },
    {
        id: "support-create-context",
        module: "support",
        title: "Create support request",
        path: "src/app/(app)/support/page.tsx",
        classification: "chat-context-only",
        capabilities: ["support.create"],
    },
    {
        id: "saved-views-create",
        module: "savedViews",
        title: "New saved view",
        path: "src/app/(app)/views/new/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["savedViews.create"],
    },
    {
        id: "saved-views-edit",
        module: "savedViews",
        title: "Edit saved view",
        path: "src/app/(app)/views/[id]/edit/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["savedViews.update"],
    },
    {
        id: "saved-views-detail",
        module: "savedViews",
        title: "Saved view detail",
        path: "src/app/(app)/views/[id]/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["savedViews.search", "savedViews.vote"],
    },
    {
        id: "saved-views-list",
        module: "savedViews",
        title: "Saved views navigation",
        path: "src/components/layout/saved-views-list.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["savedViews.search", "savedViews.vote"],
    },
    {
        id: "notifications-bell",
        module: "notifications",
        title: "Notification center",
        path: "src/components/notification-bell.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["notifications.listMine", "notifications.markRead", "notifications.markAllRead", "notifications.summarize"],
    },
    {
        id: "notifications-snooze",
        module: "notifications",
        title: "Notification snooze",
        path: "src/components/notification-snooze.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["notifications.listMine"],
    },
    {
        id: "team-dashboard",
        module: "team",
        title: "Team capacity and assignments",
        path: "src/app/(app)/team/page.tsx",
        classification: "dedicated-ui-only",
        capabilities: ["team.members", "team.capacity", "team.assignmentCandidates", "team.proposeRebalance"],
    },
] as const;

export const FORM_MANIFEST = SABAH_FORM_MANIFEST;
