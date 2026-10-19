import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalDatabaseUrl } from "../../../scripts/assert-local-database";
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
import { listDiagnostics, parseDiagnosticsFilters } from "./admin";
import { recordDiagnostic } from "./record";

const db = new PrismaClient();
const correlationId = `test-diag-${randomUUID()}`;
let safeDatabase = false;
beforeAll(() => {
    const url = assertLocalDatabaseUrl(process.env.DATABASE_URL ?? "");
    if (!url.pathname.endsWith("_test")) throw new Error("Diagnostics persistence test requires a dedicated _test database");
    safeDatabase = true;
});
afterAll(async () => {
    if (safeDatabase) await db.auditLog.deleteMany({ where: { entityType: "SYSTEM_DIAGNOSTIC", entityId: correlationId } });
    await db.$disconnect();
});

it("persists safe diagnostic metadata and queries every timeline source with real Prisma", async () => {
    await recordDiagnostic({ correlationId, category: "TEST_DIAGNOSTIC_PERSISTENCE", level: "ERROR", message: "Synthetic database integration check", metadata: { apiKey: "synthetic-private-value", status: 503 } }, db);
    const stored = await db.auditLog.findMany({ where: { entityType: "SYSTEM_DIAGNOSTIC", entityId: correlationId } });
    expect(stored).toHaveLength(1);
    expect(stored[0].metaJson).not.toContain("synthetic-private-value");
    const filters = parseDiagnosticsFilters(new Request(`https://example.test/api/admin/diagnostics?view=logs&correlationId=${correlationId}`));
    const result = await listDiagnostics(filters, db);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toMatchObject({ source: "diagnostic", correlationId, level: "ERROR", category: "TEST_DIAGNOSTIC_PERSISTENCE", message: "Synthetic database integration check" });
    expect(result.pagination.logs.hasMore).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic-private-value");
});
