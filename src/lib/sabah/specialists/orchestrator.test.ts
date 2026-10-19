import { describe, expect, it, vi } from "vitest";
import { SPECIALIST_ROLES } from "./roles";
import type { SpecialistToolContext, VerificationTarget } from "./contracts";
import {
    mergeSpecialistFindings,
    planSpecialistRuns,
    runSpecialist,
    type EvidencePack,
    type SpecialistFinding,
    type SpecialistRequest,
    type SpecialistCall,
} from "./orchestrator";

const evidence: EvidencePack = {
    sources: [{ id: "task:t1", checksum: "sha256:one", freshness: new Date(Date.now() - 60_000).toISOString(), classification: "authorized", snippet: "Task evidence" }],
    authorizedSourceIds: ["task:t1"],
};
const request = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    workflowId: "wf-1", intent: "Review team workload and propose changes", moduleCount: 2, itemCount: 1,
    ambiguity: false, confidence: 0.95, sensitive: false, evidence, ...overrides,
});
const output = { summary: "ok", sourceIds: ["task:t1"], disagreements: [] };

 describe("bounded specialist orchestration", () => {
    it("exposes exactly the seven ordered roles with bounded metadata", () => {
        expect(SPECIALIST_ROLES.map((role) => role.name)).toEqual(["Retriever", "Planner", "Duplicate Analyst", "Team/KPI Analyst", "Critic", "Executor", "Verifier"]);
        expect(SPECIALIST_ROLES).toHaveLength(7);
        for (const role of SPECIALIST_ROLES) {
            expect(role.providerRole).toBeTruthy(); expect(role.modelRole).toBeTruthy(); expect(role.inputSchema).toBeTruthy(); expect(role.outputSchema).toBeTruthy();
            expect(role.allowedReadServices.length).toBeGreaterThan(0); expect(role.timeoutMs).toBeGreaterThan(0); expect(role.maxOutputChars).toBeGreaterThan(0);
            expect(typeof role.canExecute).toBe("boolean"); expect(typeof role.canApprove).toBe("boolean");
        }
        expect(SPECIALIST_ROLES.find((role) => role.name === "Critic")).toMatchObject({ canApprove: false, canExecute: false });
    });
    it("does not plan routine simple requests", () => expect(planSpecialistRuns(request({ moduleCount: 1, itemCount: 1, intent: "show my tasks" }))).toEqual([]));
    it.each([["cross-module", { moduleCount: 2 }], ["bulk", { itemCount: 20 }], ["ambiguity", { ambiguity: true }], ["low confidence", { confidence: 0.5 }], ["sensitive", { sensitive: true }]])("routes %s work to bounded specialist groups", (_label, changes) => {
        const plan = planSpecialistRuns(request(changes)); expect(plan.length).toBeGreaterThan(0); expect(plan.length).toBeLessThanOrEqual(7);
        expect(plan.map((run) => run.roleName)).toEqual(["Retriever", "Planner", "Duplicate Analyst", "Team/KPI Analyst", "Critic"]);
        expect(plan.map((run) => run.roleName)).toEqual([...plan].sort((a, b) => SPECIALIST_ROLES.findIndex((role) => role.name === a.roleName) - SPECIALIST_ROLES.findIndex((role) => role.name === b.roleName)).map((run) => run.roleName));
        expect(Math.max(...plan.map((run) => run.parallelGroup))).toBeLessThan(3);
    });
    it("gates Executor on approval and Verifier on completed writes", () => {
        expect(planSpecialistRuns(request()).map((run) => run.roleName)).not.toContain("Executor");
        expect(planSpecialistRuns(request(), { approved: true }).map((run) => run.roleName)).toContain("Executor");
        expect(planSpecialistRuns(request(), { approved: true, writesCompleted: true }).map((run) => run.roleName)).toEqual(["Retriever", "Planner", "Duplicate Analyst", "Team/KPI Analyst", "Critic", "Executor", "Verifier"]);
    });

    it("rejects malformed, unauthorized, stale, future, private, or unbounded evidence", () => {
        const invalid = [
            { ...evidence, authorizedSourceIds: [] }, { ...evidence, authorizedSourceIds: ["task:t1", "task:t1"] },
            { ...evidence, sources: [{ ...evidence.sources[0], classification: "private" as const }] },
            { ...evidence, sources: [{ ...evidence.sources[0], freshness: "2020-01-01T00:00:00.000Z" }] },
            { ...evidence, sources: [{ ...evidence.sources[0], freshness: "2030-01-01T00:00:00.000Z" }] },
            { ...evidence, sources: [{ ...evidence.sources[0], snippet: "x".repeat(5001) }] }, { ...evidence, sources: [{ ...evidence.sources[0], checksum: "" }] },
        ];
        for (const candidate of invalid) expect(() => planSpecialistRuns(request({ evidence: candidate }))).toThrow();
        expect(() => planSpecialistRuns(request({ evidence: { ...evidence, rawDatabaseDump: "forbidden" } }))).toThrow();
    });
    it("maps provider/model roles and bounds findings plus source references", async () => {
        const planner = SPECIALIST_ROLES.find((role) => role.name === "Planner"); expect(planner?.providerRole).toBe("planner"); expect(planner?.modelRole).toBe("PLANNER");
        const finding = await runSpecialist("Retriever", request(), { call: async () => ({ summary: "x".repeat(100), sourceIds: ["task:t1"], disagreements: [] }) });
        expect(finding.summary.length).toBeLessThanOrEqual(2000); expect(finding.sourceIds).toEqual(["task:t1"]);
    });
    it("enforces read service authorization through the injected reader", async () => {
        const read = vi.fn(async () => "data");
        await expect(runSpecialist("Retriever", request(), { call: async (_request, _role, tools) => { await tools.read("workflow-context"); return output; }, read })).rejects.toThrow(/read service/i);
        await expect(runSpecialist("Retriever", request(), { call: async (_request, _role, tools) => { expect(await tools.read("authorized-source-pack")).toBe("data"); return output; }, read })).resolves.toBeTruthy();
        expect(read).toHaveBeenCalledWith("authorized-source-pack", expect.any(AbortSignal));
    });
    it("makes execution unavailable outside Executor and requires approved registered allowed capabilities", async () => {
        await expect(runSpecialist("Planner", request(), { call: async (_request, _role, tools) => { await tools.execute("tasks.update", {}); return output; } })).rejects.toThrow(/execution unavailable/i);
        const execute = vi.fn(async () => ({ ok: true }));
        const call: SpecialistCall = async (_request, _role, tools) => { await tools.execute("tasks.update", { id: "t1" }); return output; };
        await expect(runSpecialist("Executor", request(), { call, execute, approvedSteps: [{ capability: "tasks.update" }], registeredCapabilities: ["tasks.update"] })).resolves.toMatchObject({ writes: 1 });
        expect(execute).toHaveBeenCalledWith("tasks.update", { id: "t1" }, expect.any(AbortSignal));
        expect(execute).toHaveBeenCalledTimes(1);
        await expect(runSpecialist("Executor", request(), { call, execute, approvedSteps: [{ capability: "tasks.delete" }], registeredCapabilities: ["tasks.delete"] })).rejects.toThrow(/allowed/i);
        await expect(runSpecialist("Executor", request(), { call, execute, approvedSteps: [{ capability: "tasks.update" }], registeredCapabilities: [] })).rejects.toThrow(/registered/i);
    });
    it("counts every successful Executor write", async () => {
        const execute = vi.fn(async () => ({ ok: true }));
        const call: SpecialistCall = async (_request, _role, tools) => {
            await tools.execute("tasks.update", { id: "t1" });
            await tools.execute("tasks.update", { id: "t2" });
            return output;
        };
        await expect(runSpecialist("Executor", request(), { call, execute, approvedSteps: [{ capability: "tasks.update" }], registeredCapabilities: ["tasks.update"] })).resolves.toMatchObject({ writes: 2 });
        expect(execute).toHaveBeenCalledTimes(2);
    });
    it("aborts and rejects a specialist call at the bounded timeout", async () => {
        let aborted = false;
        const call: SpecialistCall = async (_request, _role, tools) => new Promise<never>((_resolve, reject) => { tools.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }); });
        await expect(runSpecialist("Retriever", request(), { call, timeoutMsOverride: 10 })).rejects.toThrow(/timed out/i);
        expect(aborted).toBe(true);
    });
    it("rejects non-finite JSON values in verifier targets and read-back results", async () => {
        const cases = [
            { result: output, error: /bounded verification target/i },
            { result: Number.POSITIVE_INFINITY, error: /result mismatch/i },
            { result: Number.NEGATIVE_INFINITY, error: /result mismatch/i },
        ];
        for (const { result, error } of cases) {
            await expect(runSpecialist("Verifier", request(), {
                call: async () => output,
                verificationTarget: { operationId: result === output ? "" : "op-1", expectedResult: null },
                writesCompleted: true,
                verifyReadBack: async () => ({ operationId: "op-1", result }),
            })).rejects.toThrow(error);
        }
    });
    it("requires a target and independently verifies exact operation and canonical result", async () => {
        const target = { operationId: "op-1", expectedResult: { summary: "ok", sourceIds: ["task:t1"], disagreements: [] } };
        await expect(runSpecialist("Verifier", request(), { call: async () => output, writesCompleted: true, verifyReadBack: async () => ({ operationId: "op-1", result: {} }) })).rejects.toThrow(/target/i);
        await expect(runSpecialist("Verifier", request(), { call: async () => output, verificationTarget: target, writesCompleted: true, verifyReadBack: async () => ({ operationId: "op-2", result: target.expectedResult }) })).rejects.toThrow(/operation/i);
        await expect(runSpecialist("Verifier", request(), { call: async () => output, verificationTarget: target, writesCompleted: true, verifyReadBack: async () => ({ operationId: "op-1", result: { ok: false } }) })).rejects.toThrow(/result/i);
        await expect(runSpecialist("Verifier", request(), { call: async () => output, verificationTarget: target, verifyReadBack: async () => ({ operationId: "op-1", result: target.expectedResult }) })).rejects.toThrow(/completed write/i);
        const result = await runSpecialist("Verifier", request(), { call: async () => output, verificationTarget: target, writesCompleted: true, verifyReadBack: async () => ({ operationId: "op-1", result: { disagreements: [], sourceIds: ["task:t1"], summary: "ok" } }) });
        expect(result.writes).toBe(0); expect(result.summary).toBe("ok");
    });
    it("merges deterministically while preserving disagreements and source refs", () => {
        const findings: SpecialistFinding[] = [{ roleName: "Planner", summary: "plan", sourceIds: ["task:t1"], disagreements: ["A vs B"], canApprove: false, canExecute: false, writes: 0 }, { roleName: "Critic", summary: "critic", sourceIds: ["task:t1"], disagreements: ["C"], canApprove: false, canExecute: false, writes: 0 }];
        expect(mergeSpecialistFindings(findings)).toEqual({ summaries: ["plan", "critic"], sourceIds: ["task:t1"], disagreements: ["A vs B", "C"], writes: 0 });
    });
    it("rejects unknown source IDs and malformed findings", () => {
        const valid: SpecialistFinding = { roleName: "Planner", summary: "plan", sourceIds: ["task:t1"], disagreements: [], canApprove: false, canExecute: false, writes: 0 };
        expect(() => mergeSpecialistFindings([valid], ["task:other"])).toThrow(/unknown source/i);
        expect(() => mergeSpecialistFindings([{ ...valid, summary: "" }])).toThrow(/malformed/i);
    });
});