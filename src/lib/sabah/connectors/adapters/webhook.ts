import { createHmac, timingSafeEqual } from "node:crypto";
import type { SabahLifecycleEventName } from "../../events/contracts";
import { MAX_BODY_BYTES, type DeliveryStore } from "../delivery";

export type InboundSuggestion = { connectorKey?: string; eventId: string; event: SabahLifecycleEventName; payload: unknown };
export type VerifiedInboundConnector = { connectorKey: string; enabled: boolean; direction: "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL"; allowedEvents: readonly SabahLifecycleEventName[]; secret: string; store: DeliveryStore; suggestionSink: (suggestion: InboundSuggestion) => Promise<void> | void };
export type InboundOptions = { body: string; headers: Headers | Record<string, string | undefined>; connector: VerifiedInboundConnector; now?: number; skewSeconds?: number; maxBodyBytes?: number };
export type InboundResult = { code: "accepted" | "body_too_large" | "invalid_signature" | "invalid_timestamp" | "timestamp_skew" | "replay" | "invalid_payload" | "event_not_allowed" | "unavailable" };
const header = (headers: InboundOptions["headers"], name: string) => headers instanceof Headers ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()];
const equal = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const MAX_PAYLOAD_DEPTH = 8;
const MAX_PAYLOAD_NODES = 500;
const SECRET_KEY = /(secret|token|password|credential|api[-_]?key)/i;
const RESTRICTED_CLASSIFICATION = /^(restricted|private|confidential|pii|secret)$/i;
function safePayload(value: unknown, depth = 0, state = { nodes: 0 }): boolean {
  if (++state.nodes > MAX_PAYLOAD_NODES || depth > MAX_PAYLOAD_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.every((item) => safePayload(item, depth + 1, state));
  if (typeof value !== "object") return false;
  return Object.entries(value).every(([key, item]) => !SECRET_KEY.test(key) && !(key.toLowerCase() === "classification" && typeof item === "string" && RESTRICTED_CLASSIFICATION.test(item)) && safePayload(item, depth + 1, state));
}
export async function verifyInboundWebhook(options: InboundOptions): Promise<InboundResult> {
  const max = Math.min(options.maxBodyBytes ?? MAX_BODY_BYTES, MAX_BODY_BYTES); if (Buffer.byteLength(options.body, "utf8") > max) return { code: "body_too_large" };
  const connector = options.connector;
  if (!connector || connector.enabled !== true || (connector.direction !== "INBOUND" && connector.direction !== "BIDIRECTIONAL") || typeof connector.secret !== "string" || typeof connector.suggestionSink !== "function" || typeof connector.store?.claimReplay !== "function" || typeof connector.store?.releaseReplay !== "function" || !Array.isArray(connector.allowedEvents)) return { code: "unavailable" };
  const timestampText = header(options.headers, "x-sabah-timestamp"); const signature = header(options.headers, "x-sabah-signature"); const timestamp = Number(timestampText);
  if (!timestampText || !signature || !Number.isSafeInteger(timestamp)) return { code: "invalid_timestamp" };
  const now = options.now ?? Math.floor(Date.now() / 1000); if (Math.abs(now - timestamp) > (options.skewSeconds ?? 300)) return { code: "timestamp_skew" };
  const expected = `sha256=${createHmac("sha256", connector.secret).update(`${timestamp}.${options.body}`, "utf8").digest("hex")}`; if (!equal(expected, signature)) return { code: "invalid_signature" };
  let payload: unknown; try { payload = JSON.parse(options.body); } catch { return { code: "invalid_payload" }; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { code: "invalid_payload" };
  if (!safePayload(payload)) return { code: "invalid_payload" };
  const candidate: Record<string, unknown> = Object.fromEntries(Object.entries(payload)); const event = candidate.event; const eventId = candidate.eventId;
  if (typeof event !== "string" || typeof eventId !== "string" || !connector.allowedEvents.includes(event as SabahLifecycleEventName)) return { code: "event_not_allowed" };
  if (!(await connector.store.claimReplay(eventId))) return { code: "replay" };
  try { await connector.suggestionSink({ connectorKey: connector.connectorKey, eventId, event: event as SabahLifecycleEventName, payload: candidate.payload }); return { code: "accepted" }; } catch { try { await connector.store.releaseReplay(eventId); } catch { /* preserve fail-closed response */ } return { code: "unavailable" }; }
}
