import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { SourceRef } from "../intelligence/contracts";
export type { SourceRef } from "../intelligence/contracts";

export type MemoryScope = "USER" | "TEAM" | "DEPARTMENT" | "WORKSPACE";
export type MemoryKind = "PREFERENCE" | "FACT" | "DECISION" | "TERMINOLOGY" | "RELATIONSHIP" | "LESSON";
export type MemoryState = "PROPOSED" | "APPROVED" | "REJECTED" | "ARCHIVED" | "SUPERSEDED";
export type MemoryProvenance = "GENERATED" | "USER_PROVIDED" | "IMPORTED" | "SYSTEM";
export type MemoryFreshness = "FRESH" | "AGING" | "STALE" | "UNKNOWN";
export type SourceVerification = "CURRENT" | "STALE" | "CONTRADICTED" | "INVISIBLE";

/** Maximum review metadata emitted by the bounded memory adapter. */
export const MEMORY_REVIEW_ID_LIMIT = 200;
/** Memory identifiers remain bounded while accommodating generated CUID values. */
export const MEMORY_REVIEW_ID_MAX_LENGTH = 128;

export type MemoryInput = {
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  provenance: MemoryProvenance;
  confidence: number;
  expiresAt?: Date | null;
  ownerId?: string | null;
  departmentId?: string | null;
  terminologyTerms?: string[];
  triggerTerms?: string[];
  sources: SourceRef[];
};
export type ApprovalRecord = { actorId: string; at: Date; reason: string };
export type MemoryRecord = MemoryInput & {
  id: string;
  state: MemoryState;
  freshness: MemoryFreshness;
  supersededById?: string | null;
  approval?: ApprovalRecord;
  createdAt: Date;
  updatedAt: Date;
};
export type MemoryProjection = { id: string; scope: MemoryScope; kind: MemoryKind; content: string; provenance: MemoryProvenance; confidence: number; freshness: MemoryFreshness; expiresAt: Date | null; ownerId: string | null; departmentId: string | null; sources: SourceRef[] };

export type MemoryAdapter = {
  create: (row: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt">) => Promise<MemoryRecord>;
  get: (id: string) => Promise<MemoryRecord | null>;
  /** Optional compare-and-set fence. Adapters that omit it cannot claim atomic transitions. */
  update: (id: string, patch: Partial<MemoryRecord>, expected?: { state?: MemoryState; supersededById?: string | null }) => Promise<MemoryRecord>;
  list: () => Promise<MemoryRecord[]>;
  /** Optional atomic two-row compare-and-set. Without it, supersession is compatibility-only and cannot claim atomicity. */
  supersede?: (oldId: string, newId: string, expectedOld: { state: MemoryState; supersededById: null }, expectedNew: { state: MemoryState; supersededById: null }) => Promise<MemoryRecord>;
  transaction: <T>(work: () => Promise<T>) => Promise<T>;
};
export type SourceVerifier = (actor: SabahActor, source: SourceRef) => Promise<SourceVerification | boolean>;
export type SourceChecksumVerifier = (actor: SabahActor, source: SourceRef) => boolean | Promise<boolean>;
export type SharedScopePolicy = (actor: SabahActor, memory: Pick<MemoryRecord, "id" | "scope" | "ownerId" | "departmentId">) => boolean | Promise<boolean>;
