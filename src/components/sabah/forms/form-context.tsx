"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SabahFieldDescriptor, SabahFormSnapshot } from "./contracts";
import type { FeedbackRecorder } from "@/lib/sabah/feedback/contracts";
import { useSabahMaybe } from "../state/sabah-context";

type FieldRegistry = Record<string, SabahFieldDescriptor>;

export type IncomingSuggestion = { proposed: unknown; base: unknown; sourceRefs?: string[]; confidence?: number; proposedDiffHash?: string };
const hashPattern = /^[a-f0-9]{64}$/;
const personalFieldSourceId = (fieldName: string) => `personal:field:${fieldName}`;
async function canonicalFieldHash(tag: string, value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(`${tag}:${JSON.stringify(value)}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type FormContextValue = {
    snapshot: SabahFormSnapshot;
    registerField: (descriptor: SabahFieldDescriptor) => void;
    unregisterField: (name: string) => void;
    getField: (name: string) => SabahFieldDescriptor | undefined;
    suggestions: Record<string, IncomingSuggestion>;
    addSuggestion: (name: string, suggestion: IncomingSuggestion) => void;
    applySummary: string | null;
    fillEmptyOnly: () => void;
    reviewAll: () => void;
    applyPending: () => Promise<void>;
    resolveField: (name: string, choice: "KEEP" | "USE_SABAH" | "MERGE" | "IGNORE") => Promise<void>;
    conflicts: string[];
    pending: string[];
    errors: Record<string, string>;
};

const SabahFormContext = createContext<FormContextValue | null>(null);

const defaultFeedbackRecorder: FeedbackRecorder = async (input) => {
    const response = await fetch("/api/ai/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (!response.ok) throw new Error("Feedback capture failed");
};

export function SabahFormProvider({
    formId,
    entityType,
    entityId,
    recordVersion,
    fields,
    suggestions = {},
    feedbackRecorder = defaultFeedbackRecorder,
    children,
}: {
    formId: string;
    entityType: string;
    entityId: string | null;
    recordVersion: string | null;
    fields: SabahFieldDescriptor[];
    suggestions?: Record<string, IncomingSuggestion>;
    feedbackRecorder?: FeedbackRecorder;
    children: ReactNode;
}) {
    const [registry, setRegistry] = useState<FieldRegistry>(() =>
        Object.fromEntries(fields.map((field) => [field.name, field]))
    );
    // Suggestions merge the (static) prop with dynamically generated ones.
    // The ref mirrors state so callbacks invoked immediately after
    // addSuggestion (e.g. FieldAssist's generate → reviewAll) see the merge
    // before React re-renders.
    const [suggestionState, setSuggestionState] = useState<Record<string, IncomingSuggestion>>(suggestions);
    const suggestionsRef = useRef<Record<string, IncomingSuggestion>>(suggestionState);
    const addSuggestion = useCallback((name: string, suggestion: IncomingSuggestion) => {
        suggestionsRef.current = { ...suggestionsRef.current, [name]: suggestion };
        setSuggestionState(suggestionsRef.current);
    }, []);
    const [applied, setApplied] = useState<string[]>([]);
    const [conflicts, setConflicts] = useState<string[]>([]);
    const [pending, setPending] = useState<string[]>([]);
    const [summary, setSummary] = useState<string | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const setLastError = (_name: string, _message: string) => setErrors((prev) => ({ ...prev, [_name]: _message }));

    const registerField = useCallback((descriptor: SabahFieldDescriptor) => {
        setRegistry((prev) => ({ ...prev, [descriptor.name]: descriptor }));
    }, []);

    const unregisterField = useCallback((name: string) => {
        setRegistry((prev) => {
            const next = { ...prev };
            delete next[name];
            return next;
        });
    }, []);

    const getField = useCallback((name: string) => registry[name], [registry]);

    const snapshot = useMemo<SabahFormSnapshot>(
        () => ({
            formId,
            entityType,
            entityId,
            recordVersion,
            fields: Object.fromEntries(Object.values(registry).map((field) => [field.name, { value: field.value }])),
        }),
        [formId, entityType, entityId, recordVersion, registry]
    );
    const sabahDispatch = useSabahMaybe()?.dispatch;

    useEffect(() => {
        if (!sabahDispatch) return;
        sabahDispatch({ type: "FORM_CONTEXT_REGISTERED", formContext: snapshot });
        return () => sabahDispatch({ type: "FORM_CONTEXT_UNREGISTERED", formId: snapshot.formId });
    }, [sabahDispatch, snapshot]);

    // Fill empty fields only: stages ONLY empty, unprotected fields for apply;
    // non-empty and protected fields are counted as protected. Nothing is
    // written until applyPending commits.
    const fillEmptyOnly = useCallback(() => {
        const staged: string[] = [];
        let protectedCount = 0;
        for (const name of Object.keys(suggestionsRef.current)) {
            const field = registry[name];
            if (!field) {
                continue;
            }
            if (field.protected || !field.empty) {
                protectedCount += 1;
                continue;
            }
            staged.push(name);
        }
        setConflicts([]);
        setApplied([]);
        setPending(staged);
        setSummary(`${protectedCount} protected · 0 overwritten`);
    }, [registry]);

    // Review mode: compute per-field conflict status, surface pending list.
    const reviewAll = useCallback(() => {
        const conflictNames: string[] = [];
        const pendingNames: string[] = [];
        for (const [name, suggestion] of Object.entries(suggestionsRef.current)) {
            const field = registry[name];
            if (!field) {
                continue;
            }
            if (field.protected) {
                continue;
            }
            const drifted = field.value !== suggestion.base && !(field.value === "" && suggestion.base === "");
            if (drifted) {
                conflictNames.push(name);
            } else {
                pendingNames.push(name);
            }
        }
        setConflicts(conflictNames);
        setPending(pendingNames);
        setApplied([]);
        setSummary(null);
    }, [registry]);

    const applyPending = useCallback(async () => {
        let filled = 0;
        let protectedCount = 0;
        const failures: string[] = [];
        for (const name of pending) {
            const field = registry[name];
            const suggestion = suggestionsRef.current[name];
            if (!field || !suggestion) {
                continue;
            }
            const validation = await field.validate(suggestion.proposed);
            if (!validation.ok) {
                failures.push(name);
                setLastError(name, validation.message);
                continue;
            }
            const commit = async (value: unknown): Promise<boolean> => {
                if (!field.commit) { setLastError(name, "Save this form before capturing feedback"); return false; }
                const committed = await field.commit(value);
                if (committed && committed.value !== value) { setLastError(name, "Saved value could not be verified"); return false; }
                return true;
            };
            if (!(await commit(validation.value))) { failures.push(name); continue; }
            field.setValue(validation.value);
            try { if (feedbackRecorder) await feedbackRecorder({ source: { kind: "FIELD", id: personalFieldSourceId(name), fieldName: name }, outcome: "ACCEPTED", context: { field: name, action: "APPLY" } }); } catch { setLastError(name, "Saved, but feedback capture is pending"); }
            filled += 1;
        }
        // count protected as everything suggested-but-not-applied
        protectedCount = Object.keys(suggestionsRef.current).filter(
            (name) => !pending.includes(name) && registry[name] != null
        ).length;
        setApplied(pending.filter((name) => !failures.includes(name)));
        setPending(failures);
        setSummary(`${filled} filled · ${protectedCount} protected · 0 overwritten`);
    }, [pending, registry, feedbackRecorder, entityType, entityId, formId]);

    const resolveField = useCallback(
        async (name: string, choice: "KEEP" | "USE_SABAH" | "MERGE" | "IGNORE") => {
            const field = registry[name];
            const suggestion = suggestionsRef.current[name];
            if (!field || !suggestion) {
                return;
            }
            if (choice === "KEEP" || choice === "IGNORE") {
                let feedbackWarning: string | null = null;
                try { if (feedbackRecorder) await feedbackRecorder({ source: { kind: "FIELD", id: personalFieldSourceId(name), fieldName: name }, outcome: choice === "KEEP" ? "REJECTED" : "IGNORED", context: { field: name, action: choice } }); } catch { feedbackWarning = "Feedback capture is pending"; }
                setConflicts((prev) => prev.filter((n) => n !== name));
                setPending((prev) => prev.filter((n) => n !== name));
                setErrors((prev) => {
                    const next = { ...prev };
                    if (feedbackWarning) next[name] = feedbackWarning;
                    else delete next[name];
                    return next;
                });
                return;
            }
            const validation = await field.validate(suggestion.proposed);
            if (!validation.ok) {
                setErrors((prev) => ({ ...prev, [name]: validation.message }));
                return;
            }
            const proposed = choice === "MERGE" ? (field.merge ? field.merge(field.value, validation.value) : undefined) : validation.value;
            if (proposed === undefined) { setErrors((prev) => ({ ...prev, [name]: "Merge is not supported for this field" })); return; }
            if (!field.commit) { setErrors((prev) => ({ ...prev, [name]: "Save this form before capturing feedback" })); return; }
            const committed = await field.commit(proposed);
            if (committed && committed.value !== proposed) { setErrors((prev) => ({ ...prev, [name]: "Saved value could not be verified" })); return; }
            field.setValue(proposed);
            let feedbackWarning: string | null = null;
            try {
                const outcome = choice === "MERGE" ? "EDITED" : "ACCEPTED";
                const suppliedProposed = choice === "MERGE" ? suggestion.proposedDiffHash ?? await field.hash?.(validation.value) : undefined;
                const suppliedFinal = choice === "MERGE" ? await field.hash?.(proposed) : undefined;
                const proposedDiffHash = choice === "MERGE" && suppliedProposed && hashPattern.test(suppliedProposed) ? suppliedProposed : choice === "MERGE" ? await canonicalFieldHash("proposed", validation.value) : undefined;
                const finalDiffHash = choice === "MERGE" && suppliedFinal && hashPattern.test(suppliedFinal) ? suppliedFinal : choice === "MERGE" ? await canonicalFieldHash("final", proposed) : undefined;
                if (choice === "MERGE" && (!proposedDiffHash || !finalDiffHash || proposedDiffHash === finalDiffHash)) throw new Error("Merge feedback hashes unavailable");
                await feedbackRecorder({ source: { kind: "FIELD", id: personalFieldSourceId(name), fieldName: name }, outcome, proposedDiffHash, finalDiffHash, context: { field: name, action: choice } });
            } catch { feedbackWarning = "Saved, but feedback capture is pending"; }
            setConflicts((prev) => prev.filter((n) => n !== name));
            setPending((prev) => prev.filter((n) => n !== name));
            setErrors((prev) => {
                const next = { ...prev };
                if (feedbackWarning) next[name] = feedbackWarning;
                else delete next[name];
                return next;
            });
        },
        [registry, feedbackRecorder, entityType, entityId, formId]
    );

    const value = useMemo<FormContextValue>(
        () => ({
            snapshot,
            registerField,
            unregisterField,
            getField,
            suggestions: suggestionState,
            addSuggestion,
            applySummary: summary,
            fillEmptyOnly,
            reviewAll,
            applyPending,
            resolveField,
            conflicts,
            pending,
            errors,
        }),
        [snapshot, registerField, unregisterField, getField, suggestionState, addSuggestion, summary, fillEmptyOnly, reviewAll, applyPending, resolveField, conflicts, pending, errors]
    );

    return <SabahFormContext.Provider value={value}>{children}</SabahFormContext.Provider>;
}

export function useSabahFormMaybe(): FormContextValue | null {
    return useContext(SabahFormContext);
}

export function useSabahForm(): FormContextValue {
    const ctx = useContext(SabahFormContext);
    if (!ctx) {
        throw new Error("useSabahForm must be used within a SabahFormProvider");
    }
    return ctx;
}

export function useSabahFormField(name: string): (SabahFieldDescriptor & { updateValue: (value: unknown) => void }) | undefined {
    const ctx = useContext(SabahFormContext);
    return ctx?.getField(name)
        ? {
              ...ctx.getField(name)!,
              updateValue: (value: unknown) => {
                  // Local component state owns the input; the registry's value updates
                  // through setValue on apply. updateValue mutates the descriptor in place.
                  const field = ctx.getField(name)!;
                  (field as { value: unknown }).value = value;
                  (field as { empty: boolean }).empty = value === "" || value === null || value === undefined;
                  ctx.registerField({ ...field, value, empty: value === "" || value === null || value === undefined });
              },
          }
        : undefined;
}
