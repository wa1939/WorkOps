import { requireAcceptedId, type ProviderResult } from "./provider-outcome";
import type { DeliverySender } from "./worker";

export type EmailDeliveryOutcome = Awaited<ReturnType<DeliverySender>>;

export type EmailSenderDependencies = {
    send: (payload: { to: string; subject: string; html: string }) => Promise<ProviderResult>;
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function normalizeResendResult(result: ProviderResult): EmailDeliveryOutcome {
    try {
        return {
            outcome: "accepted",
            providerId: requireAcceptedId(result),
        };
    } catch (error) {
        return {
            outcome: "failed",
            message: errorMessage(error),
            retryable: true,
        };
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function buildEmailSender(deps: EmailSenderDependencies): DeliverySender {
    return async (delivery, event) => {
        try {
            const result = await deps.send({
                to: delivery.destinationKey,
                subject: event.category,
                html: `<p>${escapeHtml(event.sourceType)}: ${escapeHtml(event.sourceId)}</p>`,
            });
            return normalizeResendResult(result);
        } catch (error) {
            return {
                outcome: "unknown",
                message: errorMessage(error),
            };
        }
    };
}
