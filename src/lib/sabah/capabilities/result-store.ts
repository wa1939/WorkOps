import { prisma } from "@/lib/prisma";
import type { CapabilityResultStore, CapabilityRunState } from "./runner";

// Minimal structural delegate over the AiCapabilityResult model so the store
// stays testable with a fake and independent of the full PrismaClient surface.
export type CapabilityResultRow = {
    key: string;
    state: string;
    outputJson: string | null;
    compensatedAt: Date | null;
};

export type CapabilityResultDb = {
    aiCapabilityResult: {
        findUnique(args: { where: { key: string } }): Promise<CapabilityResultRow | null>;
        create(args: { data: { key: string; state: string; outputJson: string | null } }): Promise<unknown>;
        updateMany(args: { where: { key: string; state: string; compensatedAt: null }; data: { state: string; outputJson: string | null } }): Promise<{ count: number }>;
        upsert(args: {
            where: { key: string };
            create: { key: string; state: string; outputJson: string | null; compensatedAt?: Date | null };
            update: { state?: string; outputJson?: string | null; compensatedAt?: Date | null };
        }): Promise<unknown>;
    };
};

/** Sentinel state stored when compensation is recorded before any result was saved. */
const COMPENSATED_STATE = "COMPENSATED";

function assertKey(key: string): void {
    if (typeof key !== "string" || key.trim().length === 0) {
        throw new Error("Capability result key must be a non-empty string");
    }
}

/**
 * Durable CapabilityResultStore backed by the AiCapabilityResult table.
 *
 * Rows record the terminal result of a capability execution per idempotency
 * key; compensated rows are never replayed. A row whose outputJson cannot be
 * parsed is treated as non-replayable (returns null) so the runner re-executes
 * instead of replaying corrupt output.
 */
export type CapabilityStateReader = { getState(key: string): Promise<string | null> };

export function createPrismaCapabilityResultStore(
    db: CapabilityResultDb = prisma as unknown as CapabilityResultDb,
    now: () => Date = () => new Date(),
): CapabilityResultStore & CapabilityStateReader {
    return {
        async claimExecution(key: string) {
            assertKey(key);
            try {
                await db.aiCapabilityResult.create({ data: { key, state: "EXECUTING", outputJson: null } });
                return { state: "CLAIMED" as const };
            } catch (error) {
                if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
                const row = await db.aiCapabilityResult.findUnique({ where: { key } });
                if (row?.state !== "VERIFIED" || row.compensatedAt !== null) return { state: "BUSY" as const };
                try {
                    return { state: "VERIFIED" as const, output: row.outputJson === null ? null : JSON.parse(row.outputJson) };
                } catch {
                    return { state: "BUSY" as const };
                }
            }
        },

        async getPriorResult(key: string): Promise<{ state: CapabilityRunState; output: unknown } | null> {
            assertKey(key);
            const row = await db.aiCapabilityResult.findUnique({ where: { key } });
            if (!row || row.compensatedAt !== null) return null;
            let output: unknown = null;
            if (row.outputJson !== null) {
                try {
                    output = JSON.parse(row.outputJson);
                } catch {
                    // Corrupt stored output: refuse to replay it; re-execution is the safe path.
                    return null;
                }
            }
            return { state: row.state as CapabilityRunState, output };
        },

        async saveResult(key: string, result: { state: CapabilityRunState; output: unknown }): Promise<void> {
            assertKey(key);
            const outputJson = result.output === undefined ? null : JSON.stringify(result.output);
            if (result.state === "VERIFIED") {
                const finalized = await db.aiCapabilityResult.updateMany({
                    where: { key, state: "EXECUTING", compensatedAt: null },
                    data: { state: result.state, outputJson },
                });
                if (finalized.count === 1) return;
                try {
                    await db.aiCapabilityResult.create({ data: { key, state: result.state, outputJson } });
                    return;
                } catch (error) {
                    if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new Error("Capability result is already finalized");
                    throw error;
                }
            }
            await db.aiCapabilityResult.upsert({
                where: { key },
                create: { key, state: result.state, outputJson },
                update: { state: result.state, outputJson },
            });
        },

        async markCompensated(key: string): Promise<void> {
            assertKey(key);
            const compensatedAt = now();
            await db.aiCapabilityResult.upsert({
                where: { key },
                create: { key, state: COMPENSATED_STATE, outputJson: null, compensatedAt },
                update: { compensatedAt },
            });
        },

        async isCompensated(key: string): Promise<boolean> {
            assertKey(key);
            const row = await db.aiCapabilityResult.findUnique({ where: { key } });
            return row !== null && row.compensatedAt !== null;
        },

        // Extra to the runner interface: raw stored state (e.g. the EXECUTING
        // intent) so recovery can tell "never executed" from "unverified write".
        async getState(key: string): Promise<string | null> {
            assertKey(key);
            const row = await db.aiCapabilityResult.findUnique({ where: { key } });
            return row?.state ?? null;
        },
    };
}
