import crypto from "node:crypto";
import { redactSabahPayload } from "../logging/redact";
import { scanAndRedactSecrets } from "../security/secret-scan";
import { SABAH_LIFECYCLE_EVENT_NAMES, type EventHandler, type LifecycleEventInput, type SabahLifecycleEvent } from "./contracts";
import type { SourceRef } from "../intelligence/contracts";

export interface EventPersistence { persist(event: SabahLifecycleEvent): Promise<void>; }
export type EventDeliveryResult = { event: SabahLifecycleEvent; handlerFailures: Error[] };
const MAX_PAYLOAD_STRING = 4_000;
const MAX_REFS = 20;
const MAX_REF_STRING = 200;
const ENTITY_TYPES = ["PROJECT", "TASK", "KPI", "PMO_ACTION", "NOTE", "LEAVE", "CASE_STUDY", "REPORT", "SUPPORT_REQUEST"] as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SAFE_HREF_PATTERN = /^\/[A-Za-z0-9/_?&=#%:.-]*$/;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function freeze(value: unknown, seen = new Set<object>()): unknown {
  if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child, seen);
  }
  return value;
}
function validName(name: string): boolean { return (SABAH_LIFECYCLE_EVENT_NAMES as readonly string[]).includes(name); }
function validTimestamp(value: unknown): value is string { if (typeof value !== "string" || !ISO_PATTERN.test(value)) return false; const time = Date.parse(value); return Number.isFinite(time) && time <= Date.now() + MAX_FUTURE_SKEW_MS; }
function validateRefs(refs: SourceRef[]): void {
  if (!Array.isArray(refs) || refs.length > MAX_REFS) throw new Error("Invalid entity references");
  for (const ref of refs) {
    if (!ref || !ENTITY_TYPES.includes(ref.entityType) || typeof ref.entityId !== "string" || !ID_PATTERN.test(ref.entityId) || typeof ref.label !== "string" || ref.label.length < 1 || ref.label.length > MAX_REF_STRING || typeof ref.href !== "string" || ref.href.length > 500 || !SAFE_HREF_PATTERN.test(ref.href) || typeof ref.sourceUpdatedAt !== "string" || !validTimestamp(ref.sourceUpdatedAt) || typeof ref.checksum !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(ref.checksum)) throw new Error("Invalid entity reference");
  }
}
function isolateRef(ref: SourceRef): SourceRef {
  return {
    entityType: ref.entityType,
    entityId: ref.entityId,
    label: ref.label,
    href: ref.href,
    sourceUpdatedAt: ref.sourceUpdatedAt,
    checksum: ref.checksum,
  };
}

export class LifecycleEventBus {
  constructor(private readonly options: { persistence: EventPersistence; handlers?: readonly EventHandler[] }) {}
  async publish(input: LifecycleEventInput): Promise<EventDeliveryResult> {
    if (!validName(input.name)) throw new Error(`Unsupported lifecycle event: ${String(input.name)}`);
    if (typeof input.correlationId !== "string" || !ID_PATTERN.test(input.correlationId)) throw new Error("Invalid correlation id");
    if (input.actorId !== null && (typeof input.actorId !== "string" || !ID_PATTERN.test(input.actorId))) throw new Error("Invalid actor id");
    if (input.id !== undefined && !ID_PATTERN.test(input.id)) throw new Error("Invalid event id");
    if (input.occurredAt !== undefined && !validTimestamp(input.occurredAt)) throw new Error("Invalid event timestamp");
    validateRefs(input.entityRefs);
    const scanned = scanAndRedactSecrets(redactSabahPayload(input.payload, { maxStringLength: MAX_PAYLOAD_STRING, maxArrayLength: 100, maxDepth: 8 }));
    const boundedPayload = scanned.value;
    const event = freeze({ id: input.id ?? crypto.randomUUID(), name: input.name, occurredAt: input.occurredAt ?? new Date().toISOString(), correlationId: input.correlationId, actorId: input.actorId, entityRefs: input.entityRefs.map(isolateRef), payload: boundedPayload }) as SabahLifecycleEvent;
    await this.options.persistence.persist(event);
    const settled = await Promise.allSettled((this.options.handlers ?? []).map((handler) => handler(event)));
    return { event, handlerFailures: settled.flatMap((result) => result.status === "rejected" ? [result.reason instanceof Error ? result.reason : new Error(String(result.reason))] : []) };
  }
}
