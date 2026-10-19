import { processingConsentSchema, ProcessingConsent, ProcessingMode } from "./contracts";

export class ConsentError extends Error {
  public readonly code: "CONSENT_REQUIRED" | "CONSENT_DENIED" | "CONSENT_EXPIRED" | "CONSENT_MISMATCH" | "LOCAL_ONLY";
  public constructor(code: ConsentError["code"]) { super(code); this.name = "ConsentError"; this.code = code; }
}

type CloudRequest = Pick<ProcessingConsent, "actorId" | "assetChecksum" | "provider" | "purpose">;

export function createProcessingConsent(input: ProcessingConsent): ProcessingConsent {
  return processingConsentSchema.parse(input);
}

export function assertCloudConsent(mode: ProcessingMode, consent: ProcessingConsent | undefined, request: CloudRequest, now = new Date()): void {
  if (mode === "LOCAL_ONLY") throw new ConsentError("LOCAL_ONLY");
  if (consent === undefined) throw new ConsentError("CONSENT_REQUIRED");
  if (consent.decision !== "APPROVED") throw new ConsentError("CONSENT_DENIED");
  if (consent.expiresAt.getTime() <= now.getTime()) throw new ConsentError("CONSENT_EXPIRED");
  if (consent.actorId !== request.actorId || consent.assetChecksum.toLowerCase() !== request.assetChecksum.toLowerCase()
    || consent.provider !== request.provider || consent.purpose !== request.purpose) throw new ConsentError("CONSENT_MISMATCH");
}
