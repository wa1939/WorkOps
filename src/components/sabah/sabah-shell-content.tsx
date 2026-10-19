"use client";

import React, { useEffect, useState } from "react";
import { ActivityView } from "./activity/activity-view";
import { ContextView } from "./context/context-view";
import { useSabah } from "./state/sabah-context";
import type { MemoryCardRecord } from "./context/memory-card";
import type { PlaybookCardRecord, PlaybookVersion } from "./context/playbook-card";
import { MEMORY_REVIEW_ID_LIMIT, MEMORY_REVIEW_ID_MAX_LENGTH } from "@/lib/sabah/memory/contracts";

const entityTypes = ["PROJECT", "TASK", "KPI", "PMO_ACTION", "NOTE", "LEAVE", "CASE_STUDY", "REPORT", "SUPPORT_REQUEST"];
const boundedId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,199}$/i.test(value);
const safeHref = (value: unknown): value is string => typeof value === "string" && value.length <= 500 && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !/^[\/]*(?:[a-z][a-z\d+.-]*:)/i.test(value) && !/[\u0000-\u001f\u007f]/.test(value);
const boundedStrings = (value: unknown, max: number, itemMax: number): value is string[] => Array.isArray(value) && value.length <= max && value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= itemMax);

const isMemoryProjection = (value: unknown): value is MemoryCardRecord => {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    const sources = item.sources;
    return boundedId(item.id) && ["USER", "TEAM", "DEPARTMENT", "WORKSPACE"].includes(String(item.scope)) && ["PREFERENCE", "FACT", "DECISION", "TERMINOLOGY", "RELATIONSHIP", "LESSON"].includes(String(item.kind)) && ["GENERATED", "USER_PROVIDED", "IMPORTED", "SYSTEM"].includes(String(item.provenance)) && typeof item.content === "string" && item.content.length <= 500 && typeof item.confidence === "number" && Number.isFinite(item.confidence) && ["FRESH", "AGING", "STALE", "UNKNOWN"].includes(String(item.freshness)) && (item.expiresAt === null || typeof item.expiresAt === "string") && Array.isArray(sources) && sources.length <= 5 && sources.every((source) => { if (!source || typeof source !== "object") return false; const ref = source as Record<string, unknown>; return entityTypes.includes(String(ref.entityType)) && boundedId(ref.entityId) && typeof ref.label === "string" && ref.label.length <= 200 && safeHref(ref.href) && typeof ref.sourceUpdatedAt === "string" && !Number.isNaN(Date.parse(ref.sourceUpdatedAt)) && typeof ref.checksum === "string" && ref.checksum.length <= 200; });
};

const isPlaybookVersion = (value: unknown): value is PlaybookCardRecord => {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return boundedId(item.id) && boundedId(item.playbookId) && Number.isInteger(item.version) && Number(item.version) > 0 && typeof item.name === "string" && item.name.length > 0 && item.name.length <= 128 && typeof item.description === "string" && item.description.length <= 128 && ["USER", "TEAM", "DEPARTMENT", "WORKSPACE"].includes(String(item.scope)) && boundedId(item.ownerId) && (item.departmentId === null || item.departmentId === undefined || boundedId(item.departmentId)) && boundedStrings(item.requiredContext, 16, 128) && boundedStrings(item.allowedCapabilities, 16, 128) && ["DRAFT", "IN_REVIEW", "APPROVED", "ARCHIVED"].includes(String(item.state)) && typeof item.checksum === "string" && item.checksum.length <= 200;
};

export function SabahShellContent() {
    const { state } = useSabah();
    const { workflow, activity } = state;
    const { activeTab } = state.shell;
    const [memories, setMemories] = useState<MemoryCardRecord[]>([]);
    const [playbooks, setPlaybooks] = useState<Array<{ playbook: PlaybookCardRecord; versions: PlaybookVersion[] }>>([]);
    const [learningUnavailable, setLearningUnavailable] = useState(false);
    const [learningDegraded, setLearningDegraded] = useState(false);
    const formContext = state.formContext;
    useEffect(() => {
        if (activeTab !== "CONTEXT") return;
        const entityType = formContext?.entityType?.toUpperCase();
        const entityId = formContext?.entityId;
        const hasEntity = !!entityType && entityTypes.includes(entityType) && !!entityId && boundedId(entityId);
        let cancelled = false;
        setLearningUnavailable(false); setLearningDegraded(false); setMemories([]); setPlaybooks([]);
        // With an open record, scope learning context to it. Without one, still
        // surface the actor's general memories/playbooks instead of a dead end.
        const query = hasEntity ? `${entityType} ${entityId}`.slice(0, 128) : "my preferences and ways of working";
        const loadMemory = fetch(`/api/ai/memory?query=${encodeURIComponent(query)}&limit=8`).then(async (response) => {
            if (!response.ok) throw new Error("memory");
            const body: unknown = await response.json();
            if (!body || typeof body !== "object" || !Array.isArray((body as { items?: unknown }).items)) throw new Error("memory-shape");
            const reviewIds = (body as { reviewIds?: unknown }).reviewIds;
            if (reviewIds !== undefined && !boundedStrings(reviewIds, MEMORY_REVIEW_ID_LIMIT, MEMORY_REVIEW_ID_MAX_LENGTH)) throw new Error("memory-shape");
            const raw = (body as { items: unknown[] }).items.slice(0, 8);
            const items = raw.filter(isMemoryProjection).map((item) => ({ ...item, state: "APPROVED" as const }));
            return { items, degraded: items.length !== raw.length || (reviewIds?.length ?? 0) > 0, unavailable: items.length !== raw.length };
        });
        const loadPlaybooks = fetch(`/api/ai/playbooks?query=${encodeURIComponent(query)}&limit=5`).then(async (response) => {
            if (!response.ok) throw new Error("playbooks");
            const body: unknown = await response.json();
            if (!Array.isArray(body)) throw new Error("playbooks-shape");
            const raw = body.slice(0, 5);
            const matches = raw.filter((item): item is { playbookId: string } => !!item && typeof item === "object" && boundedId((item as { playbookId?: unknown }).playbookId));
            const detailResults = await Promise.allSettled(matches.map(async (match) => {
                const response = await fetch(`/api/ai/playbooks/${encodeURIComponent(match.playbookId)}/versions`);
                if (!response.ok) throw new Error("playbook-detail");
                const detail: unknown = await response.json();
                if (!detail || typeof detail !== "object" || !Array.isArray((detail as { versions?: unknown[] }).versions)) throw new Error("playbook-detail-shape");
                const versionRaw = (detail as { versions: unknown[] }).versions.slice(0, 16);
                const versions = versionRaw.filter(isPlaybookVersion);
                const samePlaybookVersions = versions.filter((version) => version.playbookId === match.playbookId);
                const selected = samePlaybookVersions.find((version) => version.playbookId === match.playbookId);
                return { row: selected ? { playbook: selected, versions: samePlaybookVersions.map((version): PlaybookVersion => ({ id: version.id, version: version.version, state: version.state, checksum: version.checksum ?? "" })) } : null, degraded: versions.length !== versionRaw.length || samePlaybookVersions.length !== versions.length || samePlaybookVersions.length === 0 };
            }));
            return { rows: detailResults.filter((result): result is PromiseFulfilledResult<{ row: { playbook: PlaybookCardRecord; versions: PlaybookVersion[] } | null; degraded: boolean }> => result.status === "fulfilled").map((result) => result.value.row).filter((row): row is { playbook: PlaybookCardRecord; versions: PlaybookVersion[] } => row !== null), degraded: raw.length !== matches.length || detailResults.some((result) => result.status === "rejected" || (result.status === "fulfilled" && result.value.degraded)), unavailable: raw.length !== matches.length || detailResults.some((result) => result.status === "rejected" || (result.status === "fulfilled" && result.value.degraded)) };
        });
        void Promise.allSettled([loadMemory, loadPlaybooks]).then(([memoryResult, playbookResult]) => {
            if (cancelled) return;
            const memoryFailed = memoryResult.status === "rejected";
            const playbookFailed = playbookResult.status === "rejected";
            const nextMemories = memoryFailed ? [] : memoryResult.value.items;
            const nextPlaybooks = playbookFailed ? [] : playbookResult.value.rows;
            const memoryBranchFailed = memoryFailed || (!memoryFailed && memoryResult.value.unavailable);
            const playbookBranchFailed = playbookFailed || (!playbookFailed && playbookResult.value.unavailable);
            const branchFailed = memoryBranchFailed || playbookBranchFailed;
            const rowReviewDegraded = (!memoryFailed && memoryResult.value.degraded) || (!playbookFailed && playbookResult.value.degraded);
            const degraded = branchFailed || rowReviewDegraded;
            const hasCards = nextMemories.length > 0 || nextPlaybooks.length > 0;
            setMemories(nextMemories); setPlaybooks(nextPlaybooks); setLearningDegraded(degraded); setLearningUnavailable(branchFailed && !hasCards);
        });
        return () => { cancelled = true; };
    }, [activeTab, formContext?.entityId, formContext?.entityType]);

    switch (activeTab) {
        case "ACTIVITY": return <ActivityView items={activity} onOpenCorrelation={() => {}} />;
        case "CONTEXT": {
            const sources = formContext ? [{ id: formContext.formId, kind: "record" as const, title: `${formContext.entityType} form${formContext.entityId ? ` · ${formContext.entityId}` : ""}`, freshness: "CURRENT" }] : [];
            const intelligence = state.contextIntelligence;
            return <ContextView sources={sources} evidence={intelligence.evidence} duplicates={intelligence.duplicates} memories={memories} playbooks={playbooks} learningContextUnavailable={learningUnavailable} learningContextDegraded={learningDegraded} workflowId={intelligence.workflowId ?? workflow?.id ?? undefined} stepId={intelligence.stepId ?? workflow?.steps.find((step) => step.status === "APPROVAL_REQUIRED")?.id ?? undefined} />;
        }
        default: return null;
    }
}
