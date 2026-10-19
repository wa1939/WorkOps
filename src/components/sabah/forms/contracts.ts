export type FieldSuggestionStatus = "DRAFT" | "CONFLICT" | "APPLIED" | "REJECTED";

export type FieldSuggestion = {
    fieldName: string;
    base: unknown;
    proposed: unknown;
    sourceRefs: string[];
    confidence: number;
    status: FieldSuggestionStatus;
};

export type SabahFieldAction = "SUGGEST" | "REWRITE" | "SHORTEN" | "TRANSLATE" | "EXTRACT" | "IMPROVE";
export type SabahFieldRisk = "DRAFT" | "REVERSIBLE_WRITE" | "SENSITIVE_WRITE";

export type FieldCommit<T> = { bivarianceHack(value: T): Promise<{ value: T } | void> }["bivarianceHack"];
export type FieldMerge<T> = { bivarianceHack(current: T, proposed: T): T }["bivarianceHack"];
export type FieldHash<T> = { bivarianceHack(value: T): Promise<string> }["bivarianceHack"];

export type SabahFieldDescriptor<T = unknown> = {
    name: string;
    label: string;
    value: T;
    empty: boolean;
    protected: boolean;
    risk: SabahFieldRisk;
    actions: SabahFieldAction[];
    validate(value: unknown): Promise<{ ok: true; value: T } | { ok: false; message: string }>;
    setValue(value: T): void;
    commit?: FieldCommit<T>;
    hash?: FieldHash<T>;
    merge?: FieldMerge<T>;
};

export type SabahFormSnapshot = {
    formId: string;
    entityType: string;
    entityId: string | null;
    recordVersion: string | null;
    fields: Record<string, { value: unknown }>;
};

export type SabahPageContext = {
    formId: string;
    entityType: string;
    entityId: string | null;
    recordVersion: string | null;
    fields: Record<string, { value: string }>;
};

const MAX_PAGE_CONTEXT_FIELDS = 32;
const MAX_PAGE_CONTEXT_VALUE = 2000;
const SENSITIVE_FIELD = /(?:password|passcode|token|secret|credential|api[-_]?key|private[-_]?key|authorization|auth)/i;

function boundedContextValue(value: unknown): string {
    if (typeof value === "string") return value.slice(0, MAX_PAGE_CONTEXT_VALUE);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value === null || value === undefined) return "";
    try {
        return JSON.stringify(value).slice(0, MAX_PAGE_CONTEXT_VALUE);
    } catch {
        return "";
    }
}

/** Serialize only bounded, non-credential form values for untrusted model context. */
export function serializeSabahFormSnapshot(snapshot: SabahFormSnapshot): SabahPageContext {
    const fields: Record<string, { value: string }> = {};
    for (const [name, entry] of Object.entries(snapshot.fields).slice(0, MAX_PAGE_CONTEXT_FIELDS)) {
        if (!name || name.length > 80 || SENSITIVE_FIELD.test(name)) continue;
        fields[name] = { value: boundedContextValue(entry.value) };
    }
    return {
        formId: snapshot.formId.slice(0, 120),
        entityType: snapshot.entityType.slice(0, 80),
        entityId: snapshot.entityId?.slice(0, 200) ?? null,
        recordVersion: snapshot.recordVersion?.slice(0, 200) ?? null,
        fields,
    };
}

/** Providers without a durable commit/read-back hook fail closed and cannot capture field feedback. */
export const formFeedbackLimitation = "Field feedback is unavailable until this provider supplies a durable commit/read-back hook.";

export type ApplyFieldSuggestionInput = {
    base: unknown;
    current: unknown;
    proposed: unknown;
    protected?: boolean;
};

export type ApplyFieldSuggestionResult =
    | { status: "APPLIED"; value: unknown }
    | { status: "PROTECTED"; value: unknown }
    | { status: "CONFLICT"; value: unknown };

/**
 * Conflict-safe suggestion application: never overwrites a value that changed
 * after the suggestion was generated (base), never touches protected fields.
 */
export function applyFieldSuggestion(input: ApplyFieldSuggestionInput): ApplyFieldSuggestionResult {
    if (input.protected) {
        return { status: "PROTECTED", value: input.current };
    }
    const drifted = input.current !== input.base;
    if (drifted && input.current !== "" && input.current !== null && input.current !== undefined) {
        return { status: "CONFLICT", value: input.current };
    }
    return { status: "APPLIED", value: input.proposed };
}
