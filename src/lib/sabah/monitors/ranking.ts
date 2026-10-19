export const SUGGESTION_CATEGORIES = [
    "similar-work-on-draft",
    "empty-recorded-queue-with-eligible-pool",
    "high-confidence-overload-with-feasible-help",
    "approaching-task-with-preparation-material",
    "stale-progress-checkin",
] as const;

export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];

export type SuggestionCandidate = {
    id: string;
    category: SuggestionCategory;
    evidenceIds: readonly string[];
    fingerprint: string;
    confidence: number;
    actionableDestination: string;
    reason: string;
    expiresAt?: Date;
    subjectUserId: string;
    workspaceId: string;
    snoozedUntil?: Date | null;
    lastEmittedAt?: Date | null;
    relatedFingerprints?: readonly string[];
};

export type SuggestionCard = {
    id: string;
    category: SuggestionCategory;
    title: string;
    reason: string;
    confidence: number;
    destination: string;
    evidenceIds: string[];
    expiresAt?: Date;
};

export type SuppressionReason =
    | "insufficient-evidence"
    | "snoozed"
    | "grouped-duplicate"
    | "cooldown"
    | "expired"
    | "below-visibility-cap";

export type SuppressedItem = {
    id: string;
    reason: SuppressionReason;
};

export type RankSuggestionsOptions = {
    now: Date;
    maxVisible?: number;
};

export type RankedSuggestions = {
    visible: SuggestionCard[];
    suppressed: SuppressedItem[];
};

type EligibleCandidate = {
    candidate: SuggestionCandidate;
    index: number;
};

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

const CATEGORY_PRIORITY: Record<SuggestionCategory, number> = {
    "high-confidence-overload-with-feasible-help": 5,
    "approaching-task-with-preparation-material": 4,
    "stale-progress-checkin": 3,
    "empty-recorded-queue-with-eligible-pool": 2,
    "similar-work-on-draft": 1,
};

const CATEGORY_TITLES: Record<SuggestionCategory, string> = {
    "similar-work-on-draft": "Similar work is already in progress",
    "empty-recorded-queue-with-eligible-pool": "Your queue has eligible work",
    "high-confidence-overload-with-feasible-help": "Your workload may be overloaded",
    "approaching-task-with-preparation-material": "An approaching task is ready for preparation",
    "stale-progress-checkin": "A progress check-in may help",
};

const timestamp = (value: Date | null | undefined): number | null => {
    if (!(value instanceof Date)) return null;
    const result = value.getTime();
    return Number.isFinite(result) ? result : null;
};

const hasEvidence = (candidate: SuggestionCandidate): boolean =>
    Array.isArray(candidate.evidenceIds)
    && candidate.evidenceIds.length > 0
    && candidate.evidenceIds.every((evidenceId) => typeof evidenceId === "string" && evidenceId.trim().length > 0)
    && typeof candidate.actionableDestination === "string"
    && candidate.actionableDestination.trim().length > 0
    && typeof candidate.reason === "string"
    && candidate.reason.trim().length > 0
    && typeof candidate.confidence === "number"
    && Number.isFinite(candidate.confidence)
    && candidate.confidence >= 0.6
    && candidate.confidence <= 1;

const compareEligible = (left: EligibleCandidate, right: EligibleCandidate): number => {
    const confidenceDifference = right.candidate.confidence - left.candidate.confidence;
    if (confidenceDifference !== 0) return confidenceDifference;

    const priorityDifference = CATEGORY_PRIORITY[right.candidate.category] - CATEGORY_PRIORITY[left.candidate.category];
    if (priorityDifference !== 0) return priorityDifference;

    return left.index - right.index;
};

const fingerprintsFor = (candidate: SuggestionCandidate): Set<string> => {
    const fingerprints = new Set<string>();
    if (typeof candidate.fingerprint === "string" && candidate.fingerprint.length > 0) fingerprints.add(candidate.fingerprint);
    for (const fingerprint of candidate.relatedFingerprints ?? []) {
        if (typeof fingerprint === "string" && fingerprint.length > 0) fingerprints.add(fingerprint);
    }
    return fingerprints;
};

const makeCard = (candidate: SuggestionCandidate): SuggestionCard => ({
    id: candidate.id,
    category: candidate.category,
    title: CATEGORY_TITLES[candidate.category],
    reason: candidate.reason,
    confidence: candidate.confidence,
    destination: candidate.actionableDestination,
    evidenceIds: [...candidate.evidenceIds],
    expiresAt: candidate.expiresAt,
});

/**
 * Rank bounded, evidence-backed suggestions without consulting wall-clock time.
 *
 * A working day is deliberately approximated as 24 hours for cooldown checks;
 * callers provide `now` so this policy remains deterministic and testable.
 */
export function rankSuggestions(
    candidates: readonly SuggestionCandidate[],
    opts: RankSuggestionsOptions,
): RankedSuggestions {
    const nowMs = timestamp(opts.now);
    const suppressedByIndex: Array<{ index: number; item: SuppressedItem }> = [];
    const eligible: EligibleCandidate[] = [];

    const suppress = (index: number, candidate: SuggestionCandidate, reason: SuppressionReason) => {
        suppressedByIndex.push({ index, item: { id: candidate.id, reason } });
    };

    candidates.forEach((candidate, index) => {
        if (!hasEvidence(candidate)) {
            suppress(index, candidate, "insufficient-evidence");
            return;
        }

        const snoozedUntilMs = timestamp(candidate.snoozedUntil);
        if (nowMs !== null && snoozedUntilMs !== null && snoozedUntilMs > nowMs) {
            suppress(index, candidate, "snoozed");
            return;
        }

        const lastEmittedAtMs = timestamp(candidate.lastEmittedAt);
        if (nowMs !== null && lastEmittedAtMs !== null && lastEmittedAtMs <= nowMs && nowMs - lastEmittedAtMs < COOLDOWN_MS) {
            suppress(index, candidate, "cooldown");
            return;
        }

        const expiresAtMs = timestamp(candidate.expiresAt);
        if (nowMs !== null && expiresAtMs !== null && expiresAtMs <= nowMs) {
            suppress(index, candidate, "expired");
            return;
        }

        eligible.push({ candidate, index });
    });

    const parent = eligible.map((_, index) => index);
    const find = (index: number): number => {
        let root = index;
        while (parent[root] !== root) root = parent[root];
        while (parent[index] !== index) {
            const next = parent[index];
            parent[index] = root;
            index = next;
        }
        return root;
    };
    const union = (left: number, right: number) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
    };
    const seenFingerprints = new Map<string, number>();

    eligible.forEach((entry, index) => {
        fingerprintsFor(entry.candidate).forEach((fingerprint) => {
            const previous = seenFingerprints.get(fingerprint);
            if (previous === undefined) seenFingerprints.set(fingerprint, index);
            else union(index, previous);
        });
    });

    const groups = new Map<number, EligibleCandidate[]>();
    eligible.forEach((entry, index) => {
        const root = find(index);
        const group = groups.get(root);
        if (group) group.push(entry);
        else groups.set(root, [entry]);
    });

    const winners: EligibleCandidate[] = [];
    groups.forEach((group) => {
        group.sort(compareEligible);
        winners.push(group[0]);
        group.slice(1).forEach((duplicate) => suppress(duplicate.index, duplicate.candidate, "grouped-duplicate"));
    });

    winners.sort(compareEligible);
    const requestedMax = opts.maxVisible ?? 3;
    const maxVisible = Number.isFinite(requestedMax) ? Math.max(0, Math.floor(requestedMax)) : 3;
    const visible = winners.slice(0, maxVisible).map(({ candidate }) => makeCard(candidate));

    for (const belowCap of winners.slice(maxVisible)) {
        suppress(belowCap.index, belowCap.candidate, "below-visibility-cap");
    }

    suppressedByIndex.sort((left, right) => left.index - right.index);

    return {
        visible,
        suppressed: suppressedByIndex.map(({ item }) => item),
    };
}
