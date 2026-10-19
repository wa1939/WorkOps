export type NotificationProducerCategory = "task" | "kpi" | "pmo" | "digest" | "support" | "leave" | "workflow";
export type NotificationChannel = "in_app" | "email" | "push";

export interface NotificationProducer {
    id: string;
    seam: string;
    category: NotificationProducerCategory;
    channels: readonly NotificationChannel[];
    migrated: boolean;
}

/**
 * Exhaustive notification-producer inventory. Keep out-of-scope producers in
 * the registry with migrated=false rather than hiding them from the parity gate.
 */
export const PRODUCERS: readonly NotificationProducer[] = [
    {
        id: "due-reminders",
        seam: "src/app/api/cron/due-reminders/route.ts",
        category: "task",
        channels: ["in_app", "email"],
        migrated: true,
    },
    {
        id: "kpi-reminders",
        seam: "src/app/api/cron/kpi-reminders/route.ts",
        category: "kpi",
        channels: ["in_app"],
        migrated: true,
    },
    {
        id: "pmo-reminders-entrypoint",
        seam: "src/app/api/cron/pmo-reminders/route.ts",
        category: "pmo",
        channels: ["in_app", "email"],
        migrated: false,
    },
    {
        id: "sunday-digest",
        seam: "src/app/api/cron/sunday-digest/route.ts",
        category: "digest",
        channels: ["in_app", "email"],
        migrated: false,
    },
    {
        id: "weekly-close-nudge",
        seam: "src/app/api/cron/weekly-close-nudge/route.ts",
        category: "task",
        channels: ["in_app", "email"],
        migrated: false,
    },
    {
        id: "task-claim",
        seam: "src/app/api/tasks/[id]/claim/route.ts",
        category: "task",
        channels: ["in_app"],
        migrated: false,
    },
    {
        id: "task-offer-help",
        seam: "src/app/api/tasks/[id]/offer-help/route.ts",
        category: "task",
        channels: ["in_app"],
        migrated: false,
    },
    {
        id: "leave-delegation",
        seam: "src/lib/leave/commands.ts",
        category: "leave",
        channels: ["in_app"],
        migrated: false,
    },
    {
        id: "pmo-reminder-service",
        seam: "src/lib/pmo/reminder-service.ts",
        category: "pmo",
        channels: ["in_app", "email"],
        migrated: true,
    },
    {
        id: "support-notifications",
        seam: "src/lib/support/commands.ts",
        category: "support",
        channels: ["in_app"],
        migrated: false,
    },
    {
        id: "task-commands",
        seam: "src/lib/tasks/commands.ts",
        category: "task",
        channels: ["in_app"],
        migrated: false,
    },
    {
        id: "task-assignment-notifications",
        seam: "src/lib/tasks/notifications.ts",
        category: "task",
        channels: ["email"],
        migrated: true,
    },
] as const;
