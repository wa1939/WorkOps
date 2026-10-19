import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { enqueueBellEvent } from "./producer-helpers";
import { PRODUCERS, type NotificationProducer } from "./producers";

const REPO_ROOT = resolve(__dirname, "../../..");
const SOURCE_ROOT = join(REPO_ROOT, "src");
const DIRECT_NOTIFICATION_CREATE = /\b[A-Za-z_$][\w$]*\s*\.\s*notification\s*\.\s*create(?:Many|ManyAndReturn)?\s*\(/;
const VALID_CATEGORIES = new Set(["task", "kpi", "pmo", "digest", "support", "leave", "workflow"]);
const VALID_CHANNELS = new Set(["in_app", "email", "push"]);

/**
 * Keep the explicit producer inventory in sync with the codebase. The dynamic
 * seam scan below catches newly-added direct notification writes; this list also
 * covers producers such as task email dispatchers that have no Notification call.
 */
const EXPECTED_SEAMS = [
    "src/app/api/cron/due-reminders/route.ts",
    "src/app/api/cron/kpi-reminders/route.ts",
    "src/app/api/cron/pmo-reminders/route.ts",
    "src/app/api/cron/sunday-digest/route.ts",
    "src/app/api/cron/weekly-close-nudge/route.ts",
    "src/app/api/tasks/[id]/claim/route.ts",
    "src/app/api/tasks/[id]/offer-help/route.ts",
    "src/lib/leave/commands.ts",
    "src/lib/pmo/reminder-service.ts",
    "src/lib/support/commands.ts",
    "src/lib/tasks/commands.ts",
    "src/lib/tasks/notifications.ts",
].sort();

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (["node_modules", ".next", ".git"].includes(entry.name)) return [];
            return sourceFiles(path);
        }
        return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

function seamPath(path: string): string {
    return relative(REPO_ROOT, path).replaceAll("\\", "/");
}

function directNotificationSeams(): string[] {
    return sourceFiles(SOURCE_ROOT)
        .filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"))
        .filter((path) => seamPath(path) !== "src/lib/communications/enqueue.ts")
        .filter((path) => DIRECT_NOTIFICATION_CREATE.test(readFileSync(path, "utf8")))
        .map(seamPath)
        .sort();
}

function inMemoryOutbox() {
    const events = new Map<string, { id: string; sourceVersion: string }>();
    const notifications: unknown[] = [];
    const deliveries: Array<{ channel: string; destinationKey: string; state: string }> = [];
    const db = {
        $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback(db),
        notificationEvent: {
            upsert: async ({ create }: { create: { id: string; dedupeKey: string; sourceVersion: string } }) => {
                const existing = events.get(create.dedupeKey);
                if (existing) return existing;
                const stored = { id: create.id, sourceVersion: create.sourceVersion };
                events.set(create.dedupeKey, stored);
                return stored;
            },
        },
        delivery: {
            createMany: async ({ data }: { data: Array<{ channel: string; destinationKey: string; state: "PENDING" }> }) => {
                deliveries.push(...data);
                return { count: data.length };
            },
        },
        notification: {
            create: async ({ data }: { data: unknown }) => {
                notifications.push(data);
                return { id: `notification-${notifications.length}` };
            },
        },
    };
    return { db, notifications, deliveries };
}

describe("notification producer parity gate", () => {
    it("keeps a complete, well-formed producer registry", () => {
        expect(PRODUCERS.length).toBeGreaterThan(0);

        const ids = PRODUCERS.map((producer) => producer.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(Array.from(new Set(PRODUCERS.map((producer) => producer.seam))).sort()).toEqual(EXPECTED_SEAMS);

        for (const producer of PRODUCERS) {
            expect(producer.id).toMatch(/^[a-z0-9-]+$/);
            expect(producer.seam).toMatch(/^src\/.+\.tsx?$/);
            expect(statSync(join(REPO_ROOT, producer.seam)).isFile()).toBe(true);
            expect(VALID_CATEGORIES.has(producer.category)).toBe(true);
            expect(typeof producer.migrated).toBe("boolean");
            expect(producer.channels.length).toBeGreaterThan(0);
            expect(new Set(producer.channels).size).toBe(producer.channels.length);
            for (const channel of producer.channels) expect(VALID_CHANNELS.has(channel)).toBe(true);
        }
    });

    it("registers every direct notification producer seam", () => {
        const directSeams = directNotificationSeams();
        const registeredSeams = new Set(PRODUCERS.map((producer) => producer.seam));

        expect(directSeams.length).toBeGreaterThan(0);
        for (const seam of directSeams) expect(registeredSeams.has(seam)).toBe(true);
    });

    it("migrated seams have category, dedupe keys, and no direct Notification write", () => {
        const migrated = PRODUCERS.filter((producer) => producer.migrated);
        expect(migrated.length).toBeGreaterThan(0);

        for (const producer of migrated) {
            const source = readFileSync(join(REPO_ROOT, producer.seam), "utf8");
            expect(source).not.toMatch(DIRECT_NOTIFICATION_CREATE);
            expect(source).toMatch(/\bdedupeKey\b/);
            expect(VALID_CATEGORIES.has(producer.category)).toBe(true);
        }
    });

    it("keeps the in-app bell row when a reminder email provider fails", async () => {
        const { db, notifications, deliveries } = inMemoryOutbox();
        const result = await enqueueBellEvent(db, {
            workspaceId: "workspace-test",
            sourceType: "due-reminder",
            sourceId: "task-test",
            sourceVersion: "2026-09-07T12:00:00.000Z",
            category: "task",
            recipientUserId: "user-test",
            dedupeKey: "due-reminder:task-test:user-test",
            deliveries: [
                { channel: "in_app", destinationKey: "user-test" },
                { channel: "email", destinationKey: "user@example.test" },
            ],
            notification: {
                userId: "user-test",
                type: "task_reminder",
                title: "Task Reminder",
                body: "Task is due",
                linkUrl: "/tasks/task-test",
            },
        });

        expect(result).toEqual({ created: true });
        expect(notifications).toHaveLength(1);
        expect(deliveries.map(({ channel, destinationKey, state }) => ({ channel, destinationKey, state }))).toEqual([
            { channel: "in_app", destinationKey: "user-test", state: "PENDING" },
            { channel: "email", destinationKey: "user@example.test", state: "PENDING" },
        ]);

        const failingSender = async () => {
            throw new Error("provider unavailable");
        };
        await expect(failingSender()).rejects.toThrow("provider unavailable");
        expect(deliveries.some((delivery) => delivery.state === "DELIVERED")).toBe(false);
        expect(notifications).toHaveLength(1);
    });
});

// Keep this import type live in the test's public contract when the registry is extended.
void (null as NotificationProducer | null);
