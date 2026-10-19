import { evidencePackSchema, specialistRequestSchema, type ApprovedStep, type EvidencePack, type JsonValue, type SpecialistFinding, type SpecialistModelOutput, type SpecialistRequest, type SpecialistToolContext, type VerificationTarget } from "./contracts";
import { SPECIALIST_ROLES, roleByName, type SpecialistRoleName } from "./roles";

export type SpecialistRun = { roleName: SpecialistRoleName; parallelGroup: number };
export type SpecialistRoutingState = { approved?: boolean; writesCompleted?: boolean };
export type SpecialistCall = (input: SpecialistRequest, roleName: SpecialistRoleName, context: SpecialistToolContext) => Promise<SpecialistModelOutput>;
export type SpecialistReader = (service: string, signal: AbortSignal) => Promise<unknown>;
export type SpecialistExecutor = (capability: string, input: JsonValue, signal: AbortSignal) => Promise<unknown>;
export type VerifierReadBack = (input: { request: SpecialistRequest; target: VerificationTarget; signal: AbortSignal }) => Promise<{ operationId: string; result: unknown }>;
export type RunSpecialistOptions = {
    call: SpecialistCall; approvedSteps?: readonly ApprovedStep[]; registeredCapabilities?: readonly string[]; verifyReadBack?: VerifierReadBack; writesCompleted?: boolean;
    read?: SpecialistReader; execute?: SpecialistExecutor; verificationTarget?: VerificationTarget; timeoutMsOverride?: number; now?: () => Date;
};
export type MergedSpecialistFindings = { summaries: string[]; sourceIds: string[]; disagreements: string[]; writes: number };
const MAX_ROLES = 7; const MAX_PARALLELISM = 2; const MAX_EVIDENCE_AGE_MS = 7 * 24 * 60 * 60 * 1000; const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function validateEvidence(pack: EvidencePack, now = new Date()): EvidencePack {
    const parsed = evidencePackSchema.parse(pack); const authorized = new Set(parsed.authorizedSourceIds);
    if (authorized.size !== parsed.authorizedSourceIds.length) throw new Error("Evidence authorization contains duplicates");
    const ids = new Set<string>();
    for (const source of parsed.sources) {
        if (ids.has(source.id) || !authorized.has(source.id)) throw new Error("Evidence source is unauthorized or duplicated");
        ids.add(source.id); const age = now.getTime() - Date.parse(source.freshness);
        if (age > MAX_EVIDENCE_AGE_MS) throw new Error("Evidence source is stale");
        if (age < -MAX_FUTURE_SKEW_MS) throw new Error("Evidence source is from the future");
    }
    if (ids.size !== authorized.size) throw new Error("Evidence authorization does not match sources"); return parsed;
}
function validateRequest(request: unknown, now = new Date()): SpecialistRequest { const parsed = specialistRequestSchema.parse(request); return { ...parsed, evidence: validateEvidence(parsed.evidence, now) }; }
export function planSpecialistRuns(request: unknown, routing: SpecialistRoutingState = {}): SpecialistRun[] {
    const safeRequest = validateRequest(request); const needsSpecialists = safeRequest.moduleCount > 1 || safeRequest.itemCount > 10 || safeRequest.ambiguity || safeRequest.confidence < 0.8 || safeRequest.sensitive;
    if (!needsSpecialists) return []; const names: SpecialistRoleName[] = SPECIALIST_ROLES.map((role) => role.name); if (names.length > MAX_ROLES) throw new Error("Specialist role limit exceeded");
    const analysis = names.slice(0, 5);
    const gated: SpecialistRoleName[] = ["Executor", "Verifier"].filter((name): name is SpecialistRoleName =>
        (name === "Executor" && routing.approved === true) || (name === "Verifier" && routing.writesCompleted === true),
    );
    return [...analysis, ...gated].map((roleName, index) => ({ roleName, parallelGroup: index === 0 ? 0 : index < 4 ? 1 : 2 }));
}
function boundedOutput(roleName: SpecialistRoleName, output: SpecialistModelOutput, request: SpecialistRequest): SpecialistFinding {
    const role = roleByName(roleName); if (!role) throw new Error("Unknown specialist role"); const parsed = role.outputSchema.parse(output);
    const validSourceIds = new Set(request.evidence.sources.map((source) => source.id)); if (parsed.sourceIds.some((sourceId) => !validSourceIds.has(sourceId))) throw new Error("Finding contains an unknown source reference");
    return { roleName, summary: parsed.summary.slice(0, role.maxOutputChars), sourceIds: Array.from(new Set(parsed.sourceIds)), disagreements: Array.from(new Set(parsed.disagreements)).map((item) => item.slice(0, 500)), canApprove: role.canApprove, canExecute: role.canExecute, writes: 0 };
}
function isJsonValue(value: unknown): value is JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJsonValue);
    if (typeof value !== "object") return false;
    return Object.values(value).every(isJsonValue);
}
function canonical(value: JsonValue): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
}
function targetOrThrow(target: VerificationTarget | undefined): VerificationTarget {
    if (!target || typeof target.operationId !== "string" || target.operationId.trim().length === 0 || target.operationId.length > 200 || !isJsonValue(target.expectedResult)) throw new Error("Verifier requires a bounded verification target");
    return target;
}
async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([work(controller.signal), new Promise<T>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Specialist operation timed out")); }, timeoutMs); })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
}
export async function runSpecialist(roleName: SpecialistRoleName, request: unknown, options: RunSpecialistOptions): Promise<SpecialistFinding> {
    const safeRequest = validateRequest(request, options.now?.() ?? new Date()); const role = roleByName(roleName); if (!role) throw new Error("Unknown specialist role");
    if (roleName === "Critic" && (role.canApprove || role.canExecute)) throw new Error("Critic cannot approve or execute");
    const approved = new Set((options.approvedSteps ?? []).map((step) => step.capability)); const registered = new Set(options.registeredCapabilities ?? []);
    const timeoutMs = options.timeoutMsOverride === undefined ? role.timeoutMs : options.timeoutMsOverride;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > role.timeoutMs) throw new Error("Invalid specialist timeout override");
    const context = (signal: AbortSignal): SpecialistToolContext => ({
        signal,
        read: async (service) => { if (!role.allowedReadServices.includes(service)) throw new Error("Read service is not authorized for this role"); if (!options.read) throw new Error("No bounded reader is available"); return options.read(service, signal); },
        execute: async (capability, input) => {
            if (!role.canExecute || roleName !== "Executor") throw new Error("Execution unavailable to this role");
            if (!role.allowedCapabilities.includes(capability)) throw new Error("Capability is not allowed for this role");
            if (!approved.has(capability)) throw new Error("Capability is not explicitly approved"); if (!registered.has(capability)) throw new Error("Capability is not registered"); if (!options.execute) throw new Error("No bounded executor is available");
            return options.execute(capability, input, signal);
        },
    });
    if (roleName === "Executor" && (approved.size === 0 || (options.approvedSteps ?? []).some((step) => !registered.has(step.capability) || !role.allowedCapabilities.includes(step.capability)))) throw new Error("Executor capability is not registered or allowed");
    if (roleName === "Verifier") {
        if (options.writesCompleted !== true) throw new Error("Verifier requires a completed write");
        if (!options.verifyReadBack) throw new Error("Verifier requires an independent read-back seam"); const target = targetOrThrow(options.verificationTarget);
        const readBack = await bounded((signal) => options.verifyReadBack!({ request: safeRequest, target, signal }), timeoutMs);
        if (readBack.operationId !== target.operationId) throw new Error("Verifier operation mismatch"); if (!isJsonValue(readBack.result) || canonical(readBack.result) !== canonical(target.expectedResult)) throw new Error("Verifier result mismatch");
        const verifiedOutput = role.outputSchema.parse(readBack.result);
        return { ...boundedOutput(roleName, verifiedOutput, safeRequest), writes: 0 };
    }
    let successfulWrites = 0;
    const finding = await bounded((signal) => options.call(safeRequest, roleName, {
        ...context(signal),
        execute: async (capability, input) => { const result = await context(signal).execute(capability, input); successfulWrites += 1; return result; },
    }), timeoutMs);
    return { ...boundedOutput(roleName, finding, safeRequest), writes: roleName === "Executor" ? successfulWrites : 0 };
}
export function mergeSpecialistFindings(findings: readonly SpecialistFinding[], knownSourceIds?: readonly string[]): MergedSpecialistFindings {
    const known = knownSourceIds === undefined ? undefined : new Set(knownSourceIds);
    for (const finding of findings) {
        const role = SPECIALIST_ROLES.find((candidate) => candidate.name === finding.roleName);
        if (!role || typeof finding.summary !== "string" || finding.summary.length === 0 || finding.summary.length > role.maxOutputChars || !Array.isArray(finding.sourceIds) || !finding.sourceIds.every((id) => typeof id === "string" && id.length > 0) || !Array.isArray(finding.disagreements) || !finding.disagreements.every((item) => typeof item === "string") || typeof finding.canApprove !== "boolean" || typeof finding.canExecute !== "boolean" || finding.canApprove !== role.canApprove || finding.canExecute !== role.canExecute || !Number.isInteger(finding.writes) || finding.writes < 0 || (!role.canExecute && finding.writes !== 0)) throw new Error("Malformed specialist finding");
        if (known && finding.sourceIds.some((sourceId) => !known.has(sourceId))) throw new Error("Finding contains an unknown source reference");
    }
    const order = new Map<string, number>(SPECIALIST_ROLES.map((role, index) => [role.name, index])); const sorted = [...findings].sort((a, b) => (order.get(a.roleName) ?? MAX_ROLES) - (order.get(b.roleName) ?? MAX_ROLES));
    return { summaries: sorted.map((finding) => finding.summary), sourceIds: Array.from(new Set(sorted.flatMap((finding) => finding.sourceIds))).sort(), disagreements: sorted.flatMap((finding) => finding.disagreements), writes: sorted.reduce((total, finding) => total + finding.writes, 0) };
}
export { MAX_PARALLELISM }; export type { EvidencePack, SpecialistFinding, SpecialistRequest } from "./contracts";
