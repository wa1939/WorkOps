import { createHash } from "node:crypto";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { CapabilityRisk } from "@/lib/sabah/capabilities/contracts";
import type { MemoryRecord, MemoryScope, SharedScopePolicy } from "@/lib/sabah/memory/contracts";

export type PlaybookState = "DRAFT" | "IN_REVIEW" | "APPROVED" | "ARCHIVED";
export type PlaybookTriggers = { readonly en: readonly string[]; readonly ar: readonly string[] };
export type EvaluationCase = { readonly input: string; readonly expected: string };
export type PlaybookDraftInput = {
  playbookId: string; version: number; name: string; description: string;
  scope: MemoryScope; ownerId: string; departmentId?: string | null;
  triggers: PlaybookTriggers; requiredContext: readonly string[]; allowedCapabilities: readonly string[];
  requiredApprovals: readonly string[]; approvalOverrides?: readonly string[];
  outputSchema: Readonly<Record<string, unknown>>; evaluationCases: readonly EvaluationCase[];
};
export type PlaybookRecord = PlaybookDraftInput & {
  id: string; state: PlaybookState; builtin: boolean; checksum?: string;
  createdAt: Date; updatedAt: Date;
};
export type PlaybookScopeIdentity = Pick<MemoryRecord, "id" | "scope" | "ownerId" | "departmentId">;
export type PlaybookAdapter = {
  create(row: Omit<PlaybookRecord, "id" | "createdAt" | "updatedAt">): Promise<PlaybookRecord>;
  get(id: string): Promise<PlaybookRecord | null>;
  /** Adapter must atomically reject stale expected checksum/version/state; rollback remains adapter responsibility. */
  update(id: string, patch: Pick<PlaybookRecord, "state">, expected: { checksum: string; version: number; state: PlaybookState }): Promise<PlaybookRecord>;
  list(): Promise<PlaybookRecord[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  rows?: PlaybookRecord[];
};
export type CapabilityRegistryLike = {
  resolve(name: string, version?: number): { name: string; risk: CapabilityRisk };
};
export type PlaybookPolicy = SharedScopePolicy;
export type PlaybookServiceOptions = {
  adapter: PlaybookAdapter; registry: CapabilityRegistryLike; now?: () => Date;
  sharedAccessPolicy?: PlaybookPolicy; sharedApprovalPolicy?: PlaybookPolicy;
  globalRequiredApprovals?: readonly string[];
};
export type PlaybookActor = SabahActor;
export type PlaybookMatch = { playbookId: string; version: number; score: number; reasons: string[]; requiredContext: string[] };

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Non-finite number is not canonicalizable");
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  return value;
};

export function playbookContentChecksum(input: PlaybookDraftInput): string {
  return JSON.stringify(canonicalize({ playbookId: input.playbookId, version: input.version, name: input.name, description: input.description,
    scope: input.scope, ownerId: input.ownerId, departmentId: input.departmentId ?? null,
    triggers: { en: [...input.triggers.en], ar: [...input.triggers.ar] }, requiredContext: [...input.requiredContext],
    allowedCapabilities: [...input.allowedCapabilities], requiredApprovals: [...input.requiredApprovals], approvalOverrides: [...(input.approvalOverrides ?? [])],
    outputSchema: input.outputSchema, evaluationCases: input.evaluationCases.map((item) => ({ input: item.input, expected: item.expected })) }));
}
export function playbookChecksum(input: PlaybookDraftInput): string { return createHash("sha256").update(playbookContentChecksum(input)).digest("hex"); }

const LIMITS = { id: 80, text: 128, items: 16, context: 64, schemaKeys: 32, evaluations: 16 } as const;
const boundedString = (value: unknown, limit: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= limit;
const boundedStrings = (value: unknown, limit: number, itemLimit: number, allowEmpty = false): value is readonly string[] => Array.isArray(value) && value.length <= limit && (allowEmpty || value.length > 0) && value.every((item) => boundedString(item, itemLimit));
const boundedSchema = (value: unknown, depth = 0): boolean => {
  if (depth > 4 || value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).length <= LIMITS.schemaKeys && Object.entries(value).every(([key, child]) => boundedString(key, LIMITS.id) && (typeof child === "string" ? child.length <= LIMITS.text : typeof child === "number" ? Number.isFinite(child) : typeof child === "boolean" || boundedSchema(child, depth + 1)));
};
export function isValidPlaybookRecord(value: unknown): value is PlaybookRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PlaybookRecord>;
  const triggers = row.triggers;
  const evaluations = row.evaluationCases;
  return boundedString(row.id, LIMITS.id) && boundedString(row.playbookId, LIMITS.id) && Number.isInteger(row.version) && (row.version as number) >= 1 && boundedString(row.name, LIMITS.text) && boundedString(row.description, LIMITS.text) && ["USER", "DEPARTMENT", "TEAM", "WORKSPACE"].includes(row.scope as string) && boundedString(row.ownerId, LIMITS.id) && (row.departmentId === null || row.departmentId === undefined || boundedString(row.departmentId, LIMITS.id)) && !!triggers && boundedStrings(triggers.en, LIMITS.items, LIMITS.text) && boundedStrings(triggers.ar, LIMITS.items, LIMITS.text) && boundedStrings(row.requiredContext, LIMITS.items, LIMITS.context) && boundedStrings(row.allowedCapabilities, LIMITS.items, LIMITS.id) && boundedStrings(row.requiredApprovals, LIMITS.items, LIMITS.id, true) && (row.approvalOverrides === undefined || boundedStrings(row.approvalOverrides, LIMITS.items, LIMITS.id, true)) && boundedSchema(row.outputSchema) && Array.isArray(evaluations) && evaluations.length > 0 && evaluations.length <= LIMITS.evaluations && evaluations.every((item) => !!item && typeof item === "object" && boundedString((item as EvaluationCase).input, LIMITS.text) && boundedString((item as EvaluationCase).expected, LIMITS.text)) && ["DRAFT", "IN_REVIEW", "APPROVED", "ARCHIVED"].includes(row.state as string) && typeof row.builtin === "boolean" && (row.createdAt instanceof Date) && !Number.isNaN(row.createdAt.getTime()) && (row.updatedAt instanceof Date) && !Number.isNaN(row.updatedAt.getTime()) && boundedString(row.checksum, 128);
}
