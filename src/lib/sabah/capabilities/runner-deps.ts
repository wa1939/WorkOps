import { prisma } from "@/lib/prisma";
import { capabilityRegistry } from "./registry";
import type { RunnerDeps } from "./runner";
import { getSabahFlags } from "../flags";
import { registerOperationalCapabilities } from "./register-operational";
import { registerWorkspaceCapabilitySet } from "./register-workspace";
import { registerLearningCapabilities, getLearningDependencies } from "./modules/learning";
import { createPrismaCapabilityResultStore } from "./result-store";

// Platform startup registration. The registrar is safe to call during hot reload.
// It deliberately owns the complete reviewed order: core → PMO → Notes → Leave
// → Case Studies → Reports → Support → Saved Views → Notifications → Team.
registerOperationalCapabilities(capabilityRegistry);
registerWorkspaceCapabilitySet(capabilityRegistry);
registerLearningCapabilities(capabilityRegistry, getLearningDependencies());

/**
 * Get real runner dependencies for production use.
 *
 * Provides the real registry, database, durable capability result store
 * (idempotent replay + compensation tracking), and flags needed
 * by the capability runner.
 */
export function getRunnerDeps(): RunnerDeps {
    return {
        registry: capabilityRegistry,
        db: prisma as unknown as RunnerDeps["db"],
        store: createPrismaCapabilityResultStore(),
        now: () => new Date(),
        flags: getSabahFlags(),
    };
}