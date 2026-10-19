import { describe, expect, it } from "vitest";
import { MONITOR_DEFINITIONS } from "./definitions";
import { dismissSuggestion, evaluateMonitor, runMonitors, snoozeSuggestion, type MonitorReader, type MonitorStore } from "./service";
import type { MonitorActor, MonitorScope, MonitorSuggestion, MonitorSource } from "./contracts";

const actor: MonitorActor = { id: "actor-1", teamId: "team-1" };
const scope: MonitorScope = { type: "TEAM", id: "team-1" };
const source = (id: string, fingerprint: string, updatedAt = "2026-08-29T10:00:00.000Z"): MonitorSource => ({ id, kind: "task", label: `Task ${id}`, summary: "bounded summary", updatedAt, fingerprint, authorized: true });

class StatefulStore implements MonitorStore {
    suggestions: MonitorSuggestion[] = [];
    mutationCalls = 0;
    states = new Map<string, { fingerprint: string; lastRunAt: Date }>();
    private findStoredSuggestion(monitorKey: string, fingerprint: string, target: MonitorScope): MonitorSuggestion | undefined { return this.suggestions.find((s) => s.monitorKey === monitorKey && s.fingerprint === fingerprint && s.scope.id === target.id); }
    async findSuggestion(monitorKey: string, fingerprint: string, target: MonitorScope): Promise<unknown> { return this.findStoredSuggestion(monitorKey, fingerprint, target); }
    async getSuggestion(id: string, target: MonitorScope): Promise<unknown> { return this.suggestions.find((item) => item.id === id && item.scope.type === target.type && item.scope.id === target.id); }
    async saveSuggestion(suggestion: MonitorSuggestion) { const existing = this.findStoredSuggestion(suggestion.monitorKey, suggestion.fingerprint, suggestion.scope); if (existing) return existing; this.suggestions.push(suggestion); return suggestion; }
    async getState(key: string, target: MonitorScope) { return this.states.get(`${key}:${target.id}`); }
    async saveState(key: string, target: MonitorScope, state: { fingerprint: string; lastRunAt: Date }) { this.states.set(`${key}:${target.id}`, state); }
    async updateSuggestionState(id: string, state: "SNOOZED" | "DISMISSED", requestedActor: MonitorActor, target: MonitorScope) { this.mutationCalls += 1; const suggestion = this.suggestions.find((item) => item.id === id); if (!suggestion || suggestion.actorId !== requestedActor.id || suggestion.scope.id !== target.id) throw new Error("FORBIDDEN"); suggestion.state = state; if (state === "SNOOZED") suggestion.snoozedUntil = new Date(Date.now() + 60_000).toISOString(); else suggestion.dismissedAt = new Date().toISOString(); return suggestion; }
}

function readerFor(items: MonitorSource[], authorized = true): MonitorReader {
    return { async authorize() { return authorized; }, async read() { return items; } };
}

describe("Sabah proactive monitor definitions", () => {
    it("contains exactly the seven governed monitors with bounded metadata", () => {
        expect(MONITOR_DEFINITIONS.map((definition) => definition.key)).toEqual(["stale-work", "dependency-risk", "duplicate-initiatives", "kpi-gaps", "workload-conflict", "missing-updates", "deadlines"]);
        for (const definition of MONITOR_DEFINITIONS) {
            expect(definition.name.length).toBeLessThanOrEqual(80);
            expect(definition.query.maxItems).toBeGreaterThan(0);
            expect(definition.query.maxItems).toBeLessThanOrEqual(50);
            expect(definition.cooldownMs).toBeGreaterThan(0);
            expect(definition.allowedSuggestions.length).toBeLessThanOrEqual(5);
        }
    });

    it("authorizes before reading and fails closed when team scope is unavailable", async () => {
        const order: string[] = [];
        const reader: MonitorReader = { async authorize() { order.push("authorize"); return false; }, async read() { order.push("read"); return [source("1", "x")]; } };
        await expect(evaluateMonitor(MONITOR_DEFINITIONS[0], { actor, scope, reader, store: new StatefulStore(), now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "SCOPE_UNAVAILABLE" });
        expect(order).toEqual(["authorize"]);
    });

    it("emits bounded OPEN evidence with a stable fingerprint and suppresses duplicate active suggestions", async () => {
        const store = new StatefulStore();
        const context = { actor, scope, reader: readerFor([source("1", "same")]), store, now: new Date("2026-08-29T12:00:00Z") };
        const first = await evaluateMonitor(MONITOR_DEFINITIONS[0], context);
        const second = await evaluateMonitor(MONITOR_DEFINITIONS[0], context);
        expect(first.suggestion?.state).toBe("OPEN");
        expect(first.suggestion?.fingerprint).toBe(second.suggestion?.fingerprint);
        expect(store.suggestions).toHaveLength(1);
        expect(JSON.stringify(first.suggestion)).not.toMatch(/https?:|password|token|secret/i);
        expect(JSON.stringify(first.suggestion?.evidence).length).toBeLessThanOrEqual(2000);
    });

    it("allows re-notification only after material source fingerprint change and cooldown", async () => {
        const store = new StatefulStore();
        const definition = MONITOR_DEFINITIONS[0];
        const first = await evaluateMonitor(definition, { actor, scope, reader: readerFor([source("1", "one")]), store, now: new Date("2026-08-29T12:00:00Z") });
        const unchanged = await evaluateMonitor(definition, { actor, scope, reader: readerFor([source("1", "two")]), store, now: new Date("2026-08-29T12:01:00Z") });
        expect(unchanged.suggestion).toBeNull();
        const changed = await evaluateMonitor(definition, { actor, scope, reader: readerFor([source("1", "three")]), store, now: new Date("2026-08-30T12:00:00Z") });
        expect(changed.suggestion?.fingerprint).not.toBe(first.suggestion?.fingerprint);
    });

    it("enforces actor and scope isolation for snooze and dismiss", async () => {
        const store = new StatefulStore();
        // mutate() validates persisted evidence against the real clock, so the
        // fixture evidence must be fresh relative to now, not a fixed date.
        const now = new Date();
        const freshSource = source("1", "one", now.toISOString());
        const result = await evaluateMonitor(MONITOR_DEFINITIONS[0], { actor, scope, reader: readerFor([freshSource]), store, now });
        await expect(snoozeSuggestion(store, result.suggestion!.id, { actor: { id: "other", teamId: actor.teamId }, scope })).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(store.mutationCalls).toBe(0);
        await expect(dismissSuggestion(store, result.suggestion!.id, { actor, scope: { type: "TEAM", id: "other-team" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(snoozeSuggestion(store, result.suggestion!.id, { actor, scope })).resolves.toMatchObject({ state: "SNOOZED" });
    });

    it("rejects a store transition that does not return the requested state", async () => {
        const store = new StatefulStore();
        const now = new Date();
        const freshSource = source("1", "one", now.toISOString());
        const result = await evaluateMonitor(MONITOR_DEFINITIONS[0], { actor, scope, reader: readerFor([freshSource]), store, now });
        store.updateSuggestionState = async () => ({ ...result.suggestion!, state: "OPEN" });
        await expect(snoozeSuggestion(store, result.suggestion!.id, { actor, scope })).rejects.toMatchObject({ code: "DATA_INVALID" });
    });

    it("runs a bounded deterministic batch and never invokes an operational runner", async () => {
        const store = new StatefulStore();
        const result = await runMonitors({ actor, scope, reader: readerFor([source("1", "one")]), store, now: new Date("2026-08-29T12:00:00Z"), maxMonitors: 7 });
        expect(result.evaluated).toBe(7);
        expect(result.created).toBeLessThanOrEqual(7);
        expect(result.errors).toBe(0);
    });

    it("rejects malformed actor, scope, time, and monitor limits before reading", async () => {
        const reader = readerFor([source("1", "one")]);
        await expect(evaluateMonitor(MONITOR_DEFINITIONS[0], { actor: { id: "", teamId: "team-1" }, scope, reader, store: new StatefulStore(), now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "INVALID_INPUT" });
        await expect(evaluateMonitor(MONITOR_DEFINITIONS[0], { actor, scope: { type: "TEAM", id: "other-team" }, reader, store: new StatefulStore(), now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "INVALID_INPUT" });
        await expect(evaluateMonitor(MONITOR_DEFINITIONS[0], { actor, scope, reader, store: new StatefulStore(), now: new Date("invalid") })).rejects.toMatchObject({ code: "INVALID_INPUT" });
        await expect(runMonitors({ actor, scope, reader, store: new StatefulStore(), now: new Date("2026-08-29T12:00:00Z"), maxMonitors: -1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    it("rejects future, duplicate, malformed, and mismatched source evidence", async () => {
        const definition = MONITOR_DEFINITIONS[0];
        const badReader = readerFor([source("1", ""), source("1", "two"), source("2", "two", "2026-08-30T12:00:00Z")]);
        await expect(evaluateMonitor(definition, { actor, scope, reader: badReader, store: new StatefulStore(), now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "DATA_INVALID" });
        const mismatchReader: MonitorReader = { async authorize() { return true; }, async read() { return [source("1", "one")]; } };
        const mismatched = { ...definition, evidenceBuilder: () => ({ sourceId: "other", snippet: "x", fingerprint: "one", observedAt: "2026-08-29T12:00:00.000Z" }) };
        await expect(evaluateMonitor(mismatched, { actor, scope, reader: mismatchReader, store: new StatefulStore(), now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "DATA_INVALID" });
    });

    it("rejects stale evidence before persistence", async () => {
        const definition = { ...MONITOR_DEFINITIONS[0], evidenceBuilder: () => ({ sourceId: "1", snippet: "x", fingerprint: "one", observedAt: "2026-08-01T12:00:00.000Z" }) };
        await expect(evaluateMonitor(definition, { actor, scope, reader: readerFor([source("1", "one")]), store: new StatefulStore(), now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "DATA_INVALID" });
    });

    it("fails closed for malformed persisted suggestions", async () => {
        const store = new StatefulStore();
        store.findSuggestion = async (): Promise<unknown> => ({ id: "bad", monitorKey: "stale-work", fingerprint: "one", state: "OPEN", severity: "INFO", title: "x", summary: "x", evidence: [{ nope: true }], scope, actorId: actor.id, cooldownUntil: "not-a-date" });
        await expect(evaluateMonitor(MONITOR_DEFINITIONS[0], { actor, scope, reader: readerFor([source("1", "one")]), store, now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "DATA_INVALID" });
    });

    it("fails closed for hostile persisted timestamps without throwing", async () => {
        const store = new StatefulStore();
        store.findSuggestion = async (): Promise<unknown> => ({ id: "stale-work:one", monitorKey: "stale-work", fingerprint: "one", state: "OPEN", severity: "INFO", title: "x", summary: "x", evidence: [], scope, actorId: actor.id, cooldownUntil: Symbol("bad") });
        await expect(evaluateMonitor(MONITOR_DEFINITIONS[0], { actor, scope, reader: readerFor([source("1", "one")]), store, now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "DATA_INVALID" });
    });

    it.each([
        ["null evidence", null],
        ["symbol evidence fields", { sourceId: Symbol("bad"), snippet: "x", fingerprint: "one", observedAt: "2026-08-29T12:00:00.000Z" }],
    ])("fails closed for %s without throwing", async (_label, hostileEvidence) => {
        const store = new StatefulStore();
        store.findSuggestion = async (): Promise<unknown> => ({ id: "stale-work:one", monitorKey: "stale-work", fingerprint: "one", state: "OPEN", severity: "INFO", title: "x", summary: "x", evidence: [hostileEvidence], scope, actorId: actor.id, cooldownUntil: "2026-08-29T13:00:00.000Z" });
        await expect(evaluateMonitor(MONITOR_DEFINITIONS[0], { actor, scope, reader: readerFor([source("1", "one")]), store, now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "DATA_INVALID" });
    });

    it("rejects oversized persisted evidence before inspecting its items", async () => {
        const store = new StatefulStore();
        const evidence = new Proxy(Array.from({ length: 51 }, () => null), {
            get(target, property, receiver) {
                if (property !== "length") throw new Error("evidence item inspected");
                return Reflect.get(target, property, receiver);
            },
        });
        store.findSuggestion = async (): Promise<unknown> => ({ id: "stale-work:one", monitorKey: "stale-work", fingerprint: "one", state: "OPEN", severity: "INFO", title: "x", summary: "x", evidence, scope, actorId: actor.id, cooldownUntil: "2026-08-29T13:00:00.000Z" });
        await expect(evaluateMonitor(MONITOR_DEFINITIONS[0], { actor, scope, reader: readerFor([source("1", "one")]), store, now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "DATA_INVALID" });
    });

    it("rejects persisted evidence unrelated to the current source set", async () => {
        const store = new StatefulStore();
        store.findSuggestion = async (): Promise<unknown> => ({ id: "stale-work:one", monitorKey: "stale-work", fingerprint: "one", state: "OPEN", severity: "INFO", title: "x", summary: "x", evidence: [{ sourceId: "other", snippet: "x", fingerprint: "one", observedAt: "2026-08-29T12:00:00.000Z" }], scope, actorId: actor.id, cooldownUntil: "2026-08-29T13:00:00.000Z" });
        await expect(evaluateMonitor(MONITOR_DEFINITIONS[0], { actor, scope, reader: readerFor([source("1", "one")]), store, now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "DATA_INVALID" });
    });

    it("enforces workspace authorization and isolates store results", async () => {
        const workspace: MonitorScope = { type: "WORKSPACE", id: "workspace-1" };
        const denied: MonitorReader = { async authorize() { return false; }, async read() { throw new Error("must not read"); } };
        await expect(evaluateMonitor(MONITOR_DEFINITIONS[0], { actor, scope: workspace, reader: denied, store: new StatefulStore(), now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "SCOPE_UNAVAILABLE" });
        const crossActorStore = new StatefulStore();
        crossActorStore.saveSuggestion = async (suggestion) => ({ ...suggestion, actorId: "other" });
        await expect(evaluateMonitor(MONITOR_DEFINITIONS[0], { actor, scope, reader: readerFor([source("1", "one")]), store: crossActorStore, now: new Date("2026-08-29T12:00:00Z") })).rejects.toMatchObject({ code: "DATA_INVALID" });
    });
});
