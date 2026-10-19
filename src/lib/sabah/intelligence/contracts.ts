export type WorkspaceEntityType =
  | 'PROJECT'
  | 'TASK'
  | 'KPI'
  | 'PMO_ACTION'
  | 'NOTE'
  | 'LEAVE'
  | 'CASE_STUDY'
  | 'REPORT'
  | 'SUPPORT_REQUEST';

export interface SourceRef {
  entityType: WorkspaceEntityType;
  entityId: string;
  label: string;
  href: string;
  sourceUpdatedAt: string;
  checksum: string;
}

export interface SearchCandidate {
  source: SourceRef;
  score: number;
  snippet?: string;
}

export interface DuplicateCandidate {
  source: SourceRef;
  duplicateOf: SourceRef;
  score: number;
  overlap: 'EXACT' | 'LIKELY_DUPLICATE' | 'RELATED' | 'RECURRING';
  reasons: string[];
}

export interface ContextPack {
  query?: string;
  candidates: SearchCandidate[];
  duplicates?: DuplicateCandidate[];
  sources?: SourceRef[];
}
