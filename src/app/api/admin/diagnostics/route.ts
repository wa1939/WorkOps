import { NextRequest } from "next/server";
import {
    createDiagnosticCorrelationId,
    listDiagnostics,
    parseDiagnosticsFilters,
    privateDiagnosticResponse,
    requireDiagnosticsAdmin,
} from "@/lib/diagnostics/admin";
import { pruneDiagnosticLogs, recordDiagnostic } from "@/lib/diagnostics/record";

export const dynamic = "force-dynamic";

function isInvalidQuery(error: unknown): boolean {
    return error instanceof Error && (
        error.message.startsWith("Invalid ") ||
        error.message === "Cursor and page cannot be combined" ||
        error.message === "Invalid date range"
    );
}

export async function GET(request: NextRequest) {
    const correlationId = createDiagnosticCorrelationId();
    const authorization = await requireDiagnosticsAdmin(correlationId);
    if (!("actor" in authorization)) return authorization;

    try {
        const filters = parseDiagnosticsFilters(request);
        const result = await listDiagnostics(filters);
        return privateDiagnosticResponse(result, 200, correlationId);
    } catch (error) {
        if (isInvalidQuery(error)) {
            return privateDiagnosticResponse({ error: "Invalid diagnostics query" }, 400, correlationId);
        }
        console.error(JSON.stringify({ event: "diagnostic_admin_read_failure", correlationId, message: "Diagnostics read failed" }));
        return privateDiagnosticResponse({ error: "Unable to load diagnostics" }, 500, correlationId);
    }
}

/** Explicit operator-invoked cleanup. No automatic purge is implied. */
export async function DELETE(request: NextRequest) {
    const correlationId = createDiagnosticCorrelationId();
    const authorization = await requireDiagnosticsAdmin(correlationId);
    if (!("actor" in authorization)) return authorization;

    if (new URL(request.url).searchParams.toString()) {
        return privateDiagnosticResponse({ error: "Prune does not accept query parameters" }, 400, correlationId);
    }

    try {
        const result = await pruneDiagnosticLogs();
        await recordDiagnostic({
            correlationId,
            actorId: authorization.actor.id,
            category: "ADMIN_DIAGNOSTIC_PRUNE",
            level: "SECURITY",
            message: "Admin explicitly pruned expired diagnostic records",
            metadata: { count: result.count },
        });
        return privateDiagnosticResponse({ ok: true, count: result.count, retentionDays: 30 }, 200, correlationId);
    } catch {
        console.error(JSON.stringify({ event: "diagnostic_admin_prune_failure", correlationId, message: "Diagnostic prune failed" }));
        return privateDiagnosticResponse({ error: "Unable to prune diagnostics" }, 500, correlationId);
    }
}
