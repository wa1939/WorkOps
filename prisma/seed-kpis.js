/**
 * Deprecated compatibility shim — kept only so the existing two-step
 * `npm run db:demo` script (`tsx prisma/seed.ts && node prisma/seed-kpis.js`)
 * keeps working.
 *
 * The proprietary CEE 2026 BSC scorecard was removed from the shipped code.
 * Generic synthetic demo KPIs are now seeded by `prisma/seed.ts`, which is
 * opt-in (WORKOPS_DEMO_SEED=1) and refuses non-local databases.
 *
 * This shim intentionally does NOT connect to the database.
 * `npm run db:demo` can be simplified to just `tsx prisma/seed.ts`.
 */

console.log(
    "[seed-kpis] Deprecated no-op: the proprietary KPI scorecard was removed. " +
        "Generic demo KPIs are seeded by prisma/seed.ts (WORKOPS_DEMO_SEED=1). " +
        "`npm run db:demo` can be simplified to `tsx prisma/seed.ts`.",
);
