import { describe, expect, it } from "vitest";
import { rankSuggestions, type SuggestionCandidate } from "./ranking";

const now = new Date("2026-09-08T12:00:00.000Z");

const candidate = (overrides: Partial<SuggestionCandidate> = {}): SuggestionCandidate => ({
    id: "suggestion-1",
    category: "high-confidence-overload-with-feasible-help",
    evidenceIds: ["evidence-1"],
    fingerprint: "fingerprint-1",
    confidence: 0.9,
    actionableDestination: "/workload",
    reason: "The current workload has feasible help available.",
    subjectUserId: "user-1",
    workspaceId: "workspace-1",
    ...overrides,
});

describe("Sabah evidence-backed suggestion ranking", () => {
    it("low confidence load does not claim overload", () => {
        const result = rankSuggestions([candidate({ confidence: 0.4 })], { now });

        expect(result.visible).toHaveLength(0);
        expect(result.suppressed).toContainEqual({ id: "suggestion-1", reason: "insufficient-evidence" });
    });

    it("snoozed suggestion remains suppressed", () => {
        const result = rankSuggestions([candidate({ snoozedUntil: new Date("2026-09-08T13:00:00.000Z") })], { now });

        expect(result.visible).toHaveLength(0);
        expect(result.suppressed).toContainEqual({ id: "suggestion-1", reason: "snoozed" });
    });

    it("same fact from two monitors groups once", () => {
        const result = rankSuggestions([
            candidate({ id: "lower-confidence", confidence: 0.8, fingerprint: "same-fact" }),
            candidate({ id: "higher-confidence", confidence: 0.95, fingerprint: "same-fact" }),
        ], { now });

        expect(result.visible.map((card) => card.id)).toEqual(["higher-confidence"]);
        expect(result.suppressed).toContainEqual({ id: "lower-confidence", reason: "grouped-duplicate" });
    });

    it("expired suggestion is suppressed", () => {
        const result = rankSuggestions([candidate({ expiresAt: now })], { now });

        expect(result.visible).toHaveLength(0);
        expect(result.suppressed).toContainEqual({ id: "suggestion-1", reason: "expired" });
    });

    it("visible cards capped at three", () => {
        const result = rankSuggestions([
            candidate({ id: "empty-queue", category: "empty-recorded-queue-with-eligible-pool", confidence: 0.9, fingerprint: "fact-empty" }),
            candidate({ id: "stale", category: "stale-progress-checkin", confidence: 0.9, fingerprint: "fact-stale" }),
            candidate({ id: "deadline", category: "approaching-task-with-preparation-material", confidence: 0.9, fingerprint: "fact-deadline" }),
            candidate({ id: "overload", category: "high-confidence-overload-with-feasible-help", confidence: 0.9, fingerprint: "fact-overload" }),
        ], { now });

        expect(result.visible.map((card) => card.id)).toEqual(["overload", "deadline", "stale"]);
        expect(result.suppressed).toContainEqual({ id: "empty-queue", reason: "below-visibility-cap" });
    });
});
