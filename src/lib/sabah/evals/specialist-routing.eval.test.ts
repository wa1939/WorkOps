import { describe, expect, it } from "vitest";
import { SPECIALIST_ROLES } from "../specialists/roles";
import {
  mergeSpecialistFindings,
  planSpecialistRuns,
  runSpecialist,
  type EvidencePack,
  type SpecialistFinding,
  type SpecialistRequest,
} from "../specialists/orchestrator";
import type { JsonValue, VerificationTarget } from "../specialists/contracts";
import type { SpecialistCall } from "../specialists/orchestrator";

const evidence: EvidencePack = {
  sources: [
    {
      id: "project:evp-charter",
      checksum: "sha256:evp-charter",
      freshness: new Date().toISOString(),
      classification: "authorized",
      snippet: "Approved EVP charter links projects, tasks, and KPI work.",
    },
  ],
  authorizedSourceIds: ["project:evp-charter"],
};

const request = (overrides: Partial<SpecialistRequest> = {}): SpecialistRequest => ({
  workflowId: "workflow:evp",
  intent: "Assess an EVP initiative across projects, tasks, and KPIs",
  moduleCount: 3,
  itemCount: 18,
  ambiguity: true,
  confidence: 0.62,
  sensitive: false,
  evidence,
  ...overrides,
});

const output = { summary: "bounded finding", sourceIds: ["project:evp-charter"], disagreements: [] };

const roleNames = SPECIALIST_ROLES.map((role) => role.name);

describe("Plan 8 Task 10 specialist routing evaluation", () => {
  it("routes routine requests to no specialist and EVP requests to the five analysis roles", () => {
    const routine = planSpecialistRuns(request({ moduleCount: 1, itemCount: 1, ambiguity: false, confidence: 0.95 }));
    expect(routine).toEqual([]);

    const plan = planSpecialistRuns(request());
    expect(plan.map((run) => run.roleName)).toEqual([
      "Retriever",
      "Planner",
      "Duplicate Analyst",
      "Team/KPI Analyst",
      "Critic",
    ]);
    expect(plan).toHaveLength(5);
    expect(planSpecialistRuns(request(), { approved: true }).map((run) => run.roleName)).toContain("Executor");
    expect(planSpecialistRuns(request(), { approved: true, writesCompleted: true }).map((run) => run.roleName)).toContain("Verifier");
    expect(plan.map((run) => run.parallelGroup)).toEqual([0, 1, 1, 1, 2]);
    expect(Math.max(...plan.map((run) => run.parallelGroup))).toBeLessThan(3);
  });

  it("keeps the registry closed to exactly seven bounded roles", () => {
    expect(roleNames).toEqual(["Retriever", "Planner", "Duplicate Analyst", "Team/KPI Analyst", "Critic", "Executor", "Verifier"]);
    expect(new Set(roleNames).size).toBe(7);
    for (const role of SPECIALIST_ROLES) {
      expect(role.timeoutMs).toBeGreaterThan(0);
      expect(role.maxOutputChars).toBeGreaterThan(0);
      expect(role.inputSchema).toBeTruthy();
      expect(role.outputSchema).toBeTruthy();
    }
  });

  it("requires authorized, fresh, source-linked bounded evidence", () => {
    expect(() => planSpecialistRuns(request({ evidence: { ...evidence, authorizedSourceIds: [] } }))).toThrow();
    const privateEvidence = { ...evidence, sources: [{ ...evidence.sources[0], classification: "private" }] };
    expect(() => planSpecialistRuns({ ...request(), evidence: privateEvidence })).toThrow();
    expect(() => planSpecialistRuns(request({ evidence: { ...evidence, sources: [{ ...evidence.sources[0], freshness: "2020-01-01T00:00:00.000Z" }] } }))).toThrow(/stale/i);
    expect(() => planSpecialistRuns(request({ evidence: { ...evidence, sources: [{ ...evidence.sources[0], snippet: "x".repeat(2001) }] } }))).toThrow();
  });

  it("prevents execution before approval and allows only the registered tasks.update capability after approval", async () => {
    const executorCall: SpecialistCall = async (_request, _role, tools) => {
      await tools.execute("tasks.update", { taskId: "task:1" });
      return output;
    };
    const execute = async (capability: string, input: JsonValue): Promise<JsonValue> => ({ capability, input, ok: true });

    await expect(runSpecialist("Executor", request(), { call: executorCall, execute })).rejects.toThrow(/registered or allowed/i);
    await expect(runSpecialist("Executor", request(), {
      call: executorCall,
      execute,
      approvedSteps: [{ capability: "tasks.update" }],
      registeredCapabilities: ["tasks.update"],
    })).resolves.toMatchObject({ roleName: "Executor", writes: 1 });
    await expect(runSpecialist("Executor", request(), {
      call: executorCall,
      execute,
      approvedSteps: [{ capability: "tasks.delete" }],
      registeredCapabilities: ["tasks.delete"],
    })).rejects.toThrow(/allowed/i);
  });

  it("requires Verifier independent read-back with exact operation and result", async () => {
    const target: VerificationTarget = {
      operationId: "operation:tasks.update:1",
      expectedResult: output,
    };
    const readBack = async (): Promise<{ operationId: string; result: JsonValue }> => ({
      operationId: target.operationId,
      result: output,
    });

    const verifierCall: SpecialistCall = async (_request, _role, _tools) => output;
    await expect(runSpecialist("Verifier", request(), { call: verifierCall, writesCompleted: true })).rejects.toThrow(/read-back/i);
    await expect(runSpecialist("Verifier", request(), {
      call: async () => output,
      verificationTarget: target,
      writesCompleted: true,
      verifyReadBack: async () => readBack(),
    })).resolves.toMatchObject({ roleName: "Verifier", writes: 0, sourceIds: ["project:evp-charter"] });
    await expect(runSpecialist("Verifier", request(), {
      call: async () => output,
      verificationTarget: target,
      writesCompleted: true,
      verifyReadBack: async () => ({ operationId: "operation:wrong", result: output }),
    })).rejects.toThrow(/operation mismatch/i);
  });

  it("keeps Critic non-authoritative and merges findings deterministically with source refs", () => {
    const critic = SPECIALIST_ROLES.find((role) => role.name === "Critic");
    expect(critic).toMatchObject({ canApprove: false, canExecute: false });
    const findings: SpecialistFinding[] = [
      { roleName: "Critic", summary: "critic", sourceIds: ["project:evp-charter"], disagreements: ["risk"], canApprove: false, canExecute: false, writes: 0 },
      { roleName: "Planner", summary: "plan", sourceIds: ["project:evp-charter"], disagreements: ["plan-risk"], canApprove: false, canExecute: false, writes: 0 },
    ];
    expect(mergeSpecialistFindings(findings)).toEqual({
      summaries: ["plan", "critic"],
      sourceIds: ["project:evp-charter"],
      disagreements: ["plan-risk", "risk"],
      writes: 0,
    });
  });
});
