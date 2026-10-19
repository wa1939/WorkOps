import { NextRequest } from "next/server";
import {
    createDiagnosticCorrelationId,
    getDiagnosticTranscript,
    parseTranscriptFilters,
    privateDiagnosticResponse,
    requireDiagnosticsAdmin,
} from "@/lib/diagnostics/admin";
import { isSafeDiagnosticId } from "@/lib/diagnostics/record";
import { recordDiagnostic } from "@/lib/diagnostics/record";

export const dynamic = "force-dynamic";

function isInvalidQuery(error: unknown): boolean {
    return error instanceof Error && error.message.startsWith("Invalid ");
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const correlationId = createDiagnosticCorrelationId();
    const authorization = await requireDiagnosticsAdmin(correlationId);
    if (!("actor" in authorization)) return authorization;

    const { id } = await params;
    if (!isSafeDiagnosticId(id)) {
        return privateDiagnosticResponse({ error: "Invalid conversation id" }, 400, correlationId);
    }

    try {
        const filters = parseTranscriptFilters(request);
        // This audit event contains only the bounded linkage and request shape;
        // transcript content is never copied into diagnostic metadata.
        await recordDiagnostic({
            correlationId,
            actorId: authorization.actor.id,
            conversationId: id,
            category: "ADMIN_TRANSCRIPT_ACCESS",
            level: "SECURITY",
            message: "Admin transcript access requested",
            metadata: { limit: filters.limit, hasCursor: Boolean(filters.cursor) },
        });
        const result = await getDiagnosticTranscript(id, filters);
        if (!result) return privateDiagnosticResponse({ error: "Conversation not found" }, 404, correlationId);
        return privateDiagnosticResponse({ ...result, redaction: { applied: true, transcriptDuplicatedInLogs: false } }, 200, correlationId);
    } catch (error) {
        if (isInvalidQuery(error)) {
            return privateDiagnosticResponse({ error: "Invalid transcript query" }, 400, correlationId);
        }
        console.error(JSON.stringify({ event: "diagnostic_transcript_read_failure", correlationId, message: "Transcript read failed" }));
        return privateDiagnosticResponse({ error: "Unable to load transcript" }, 500, correlationId);
    }
}
