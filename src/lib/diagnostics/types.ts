export const DIAGNOSTIC_EVENT_NAMES = [
    "CHAT_REQUEST_START",
    "CHAT_REQUEST_COMPLETE",
    "CHAT_REQUEST_FAILURE",
    "CHAT_PERSISTENCE_FAILURE",
    "CHAT_TOOL_OUTCOME",
    "CHAT_CANCELED",
    "CHAT_LIMIT",
    "CHAT_MODEL_ASSIGNMENT_FALLBACK",
    "PROVIDER_REQUEST",
    "PROVIDER_RESPONSE",
    "PROVIDER_ERROR",
    "PROVIDER_FALLBACK",
    "ADMIN_TRANSCRIPT_ACCESS",
] as const;

export type DiagnosticEventName = (typeof DIAGNOSTIC_EVENT_NAMES)[number];
export type DiagnosticLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL" | "SECURITY";

/**
 * The only event shape accepted by the durable diagnostic sink. Callers must
 * obtain actorId from the server-side Sabah actor, never from request input.
 */
export type DiagnosticEvent = {
    correlationId: string;
    actorId?: string;
    conversationId?: string;
    category: string;
    level: DiagnosticLevel;
    message: string;
    metadata?: unknown;
};

/** Contract shared with the provider runtime's GLMCallOptions.onDiagnostic hook. */
export type ProviderDiagnosticEvent = {
    event: "request" | "response" | "error" | "fallback";
    provider: string;
    model: string;
    attempt: number;
    durationMs?: number;
    status?: number;
    errorCode?: string;
    message?: string;
};

export type DiagnosticSource = "diagnostic" | "audit" | "operational" | "workflow";
