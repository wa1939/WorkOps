import type { MonitorDefinition, MonitorEvidence, MonitorSource } from "./contracts";

export const MONITOR_KEYS = ["stale-work", "dependency-risk", "duplicate-initiatives", "kpi-gaps", "workload-conflict", "missing-updates", "deadlines"] as const;
const digest = (value: string): string => { let h = 2166136261; for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return (h >>> 0).toString(16).padStart(8, "0").repeat(8); };
const make = (key: (typeof MONITOR_KEYS)[number], name: string, summary: string, severity: MonitorDefinition["severity"], suggestions: readonly string[], cooldownMs: number): MonitorDefinition => {
    const build = (source: MonitorSource, now: Date, maxLength = 240): MonitorEvidence => ({ sourceId: source.id.slice(0, 100), snippet: `${source.label}: ${source.summary}`.replace(/[\r\n\t]+/g, " ").slice(0, maxLength), fingerprint: source.fingerprint.slice(0, 200), observedAt: now.toISOString() });
    return { key, name, summary, query: { scope: "TEAM/WORKSPACE", maxItems: 50, maxSnippetLength: 240 }, scopePolicy: "TEAM/WORKSPACE", scheduleClass: "HOURLY", severity, cooldownMs, allowedSuggestions: suggestions, evidenceBuilder: build, buildEvidence: (source, now) => build(source, now), fingerprint: (evidence) => digest(JSON.stringify({ key, evidence: evidence.map(({ sourceId, fingerprint }) => ({ sourceId, fingerprint })).sort((a, b) => a.sourceId.localeCompare(b.sourceId)) })) };
};
export const MONITOR_DEFINITIONS: readonly MonitorDefinition[] = [
    make("stale-work", "Stale work", "Work has not changed recently.", "WARNING", ["task-review"], 24 * 60 * 60 * 1000),
    make("dependency-risk", "Dependency risk", "A dependency may be blocking progress.", "WARNING", ["dependency-review"], 24 * 60 * 60 * 1000),
    make("duplicate-initiatives", "Duplicate initiatives", "Initiatives may overlap.", "INFO", ["initiative-review"], 48 * 60 * 60 * 1000),
    make("kpi-gaps", "KPI gaps", "A KPI needs attention.", "WARNING", ["kpi-review"], 24 * 60 * 60 * 1000),
    make("workload-conflict", "Workload conflict", "Workload signals may conflict.", "WARNING", ["workload-review"], 24 * 60 * 60 * 1000),
    make("missing-updates", "Missing updates", "Expected updates are missing.", "INFO", ["update-review"], 24 * 60 * 60 * 1000),
    make("deadlines", "Deadlines", "A deadline needs attention.", "CRITICAL", ["deadline-review"], 12 * 60 * 60 * 1000),
];
