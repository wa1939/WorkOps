// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EvidenceCard } from "./evidence-card";
import { DuplicateCard } from "./duplicate-card";
import { ContextView } from "./context-view";
import { SabahProvider, useSabah } from "../state/sabah-context";
import { SabahShellContent } from "../sabah-shell-content";

const clientMocks = vi.hoisted(() => ({ submitDecision: vi.fn() }));
vi.mock("../client", () => ({ createSabahClient: vi.fn(() => clientMocks) }));

const source = { entityType: "TASK" as const, entityId: "t1", label: "Prepare report", href: "/tasks/t1", sourceUpdatedAt: "2026-08-27T00:00:00.000Z", checksum: "c" };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

beforeEach(() => {
    // Shell width/tab persist in localStorage; a leftover active tab would make
    // the context view fetch at mount and consume the next test's fetch mock.
    window.localStorage.clear();
});

function ShellHarness() {
  const { dispatch } = useSabah();
  const loadContext = () => {
    dispatch({ type: "TAB_CHANGED", tab: "CONTEXT" });
    dispatch({ type: "CONTEXT_INTELLIGENCE_SET", evidence: [{ source, sourceLabel: "Attached task", freshness: "CURRENT", relation: "supports the draft", confidence: "HIGH" }], duplicates: [{ source, duplicateOf: source, overlap: "LIKELY_DUPLICATE", reasons: ["Normalized title matches"], score: 0.8 }], workflowId: "wf1", stepId: "step1" });
  };
  return <><button type="button" onClick={loadContext}>Load context</button><SabahShellContent /></>;
}

function LearningShellHarness() {
  const { dispatch } = useSabah();
  return <><button type="button" onClick={() => { dispatch({ type: "FORM_CONTEXT_REGISTERED", formContext: { formId: "task-edit", entityType: "task", entityId: "t1", recordVersion: "v1", fields: { title: { value: "Quarterly report" } } } }); dispatch({ type: "TAB_CHANGED", tab: "CONTEXT" }); }}>Load learning context</button><SabahShellContent /></>;
}

function EmptyLearningShellHarness() {
  const { dispatch } = useSabah();
  return <><button type="button" onClick={() => dispatch({ type: "TAB_CHANGED", tab: "CONTEXT" })}>Load empty learning context</button><SabahShellContent /></>;
}

describe("workspace context cards", () => {
  it("shows source, entity, freshness, relation, confidence and safe link", () => {
    render(<EvidenceCard source={source} sourceLabel="Authoritative task" freshness="STALE" relation="supports this draft" confidence="MEDIUM" />);
    expect(screen.getByText("Authoritative task")).toBeTruthy();
    expect(screen.getByText(/TASK/)).toBeTruthy();
    expect(screen.getByText(/STALE/)).toBeTruthy();
    expect(screen.getByText(/supports this draft/)).toBeTruthy();
    expect(screen.getByText(/MEDIUM/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Prepare report/ }).getAttribute("href")).toBe("/tasks/t1");
  });

  it("does not render unsafe legacy hrefs", () => {
    render(<ContextView sources={[{ id: "x", kind: "record", title: "Unsafe", freshness: "CURRENT", href: "//evil.example" }, { id: "y", kind: "record", title: "Backslash", freshness: "CURRENT", href: "/ok\\bad" }]} />);
    expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Backslash" })).toBeNull();
  });

  it("does not render unsafe evidence links", () => {
    render(<EvidenceCard source={{ ...source, href: "//evil.example" }} sourceLabel="Unsafe evidence" freshness="CURRENT" relation="related" confidence="LOW" />);
    expect(screen.queryByRole("link", { name: /Prepare report/ })).toBeNull();
  });

  it("disables duplicate submit while saving and exposes an error state", async () => {
    const submit = vi.fn(() => new Promise((_, reject) => setTimeout(() => reject(new Error("network")), 10)));
    render(<DuplicateCard workflowId="wf1" stepId="step1" candidate={{ source, duplicateOf: source, overlap: "LIKELY_DUPLICATE", reasons: ["match"], score: 0.8 }} onSubmit={submit} />);
    const button = screen.getByRole("button", { name: /submit resolution/i });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText("network")).toBeTruthy();
  });

  it("uses the default Sabah client with the typed decision payload", async () => {
    clientMocks.submitDecision.mockResolvedValue({});
    render(<DuplicateCard workflowId="wf1" stepId="step1" candidate={{ source, duplicateOf: source, overlap: "LIKELY_DUPLICATE", reasons: ["match"], score: 0.8 }} />);
    fireEvent.click(screen.getByRole("button", { name: /submit resolution/i }));

    await waitFor(() => expect(clientMocks.submitDecision).toHaveBeenCalledWith("wf1", expect.objectContaining({ type: "RESOLVE_DUPLICATE", stepId: "step1", resolution: "USE_EXISTING", entityType: "TASK", entityId: "t1" })));
    expect(screen.getByText("Resolution saved.")).toBeTruthy();
  });

  it("offers every explicit duplicate resolution and requires a reason for separate creation", () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(<DuplicateCard workflowId="wf1" stepId="step1" candidate={{ source, duplicateOf: source, overlap: "LIKELY_DUPLICATE", reasons: ["Normalized title matches"], score: 0.8 }} onSubmit={submit} />);
    for (const choice of ["USE_EXISTING", "UPDATE_EXISTING", "LINK", "MERGE", "CREATE_SEPARATELY"]) expect(screen.getByRole("button", { name: choice })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "CREATE_SEPARATELY" }));
    fireEvent.click(screen.getByRole("button", { name: /submit resolution/i }));
    expect(screen.getByText(/reason is required/i)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "These are distinct deliverables" } });
    fireEvent.click(screen.getByRole("button", { name: /submit resolution/i }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ resolution: "CREATE_SEPARATELY", reason: "These are distinct deliverables", entityId: "t1" }));
  });

  it("renders evidence and duplicate cards through the real Sabah shell state path", async () => {
    render(<SabahProvider><ShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load context" }));

    expect(await screen.findByLabelText("Workspace evidence")).toBeTruthy();
    expect(screen.getByLabelText("Duplicate candidate")).toBeTruthy();
    expect(screen.getByText("Attached task")).toBeTruthy();
  });

  it("loads only safe bounded memory projections for explicit form context", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ items: [{ id: "m1", scope: "TEAM", kind: "FACT", content: "A real approved memory", provenance: "USER_PROVIDED", confidence: 0.8, freshness: "FRESH", expiresAt: null, ownerId: null, departmentId: null, sources: [{ entityType: "TASK", entityId: "t1", label: "Task", href: "/tasks/t1", sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: "abc123" }] }] }), { status: 200 }));
    render(<SabahProvider><LearningShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load learning context" }));
    expect(await screen.findByText("A real approved memory")).toBeTruthy();
    expect(screen.getByText(/Source: USER_PROVIDED/)).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/ai/memory?query=TASK%20t1&limit=8"));
  });

  it("reports unavailable learning context for malformed projections", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ items: [{ id: "m1", content: "unsafe without required fields" }] }), { status: 200 }));
    render(<SabahProvider><LearningShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load learning context" }));
    expect(await screen.findByText("Learning context unavailable.")).toBeTruthy();
  });

  it("reports degraded learning when memory rows require review", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/ai/memory?")) return new Response(JSON.stringify({ items: [], reviewIds: ["m1"] }), { status: 200 });
      if (url.startsWith("/api/ai/playbooks?")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error("unexpected request");
    });
    render(<SabahProvider><LearningShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load learning context" }));
    expect(await screen.findByText("Learning context partially unavailable.")).toBeTruthy();
    expect(screen.queryByText("Learning context unavailable.")).toBeNull();
  });

  it("loads and renders bounded playbook cards and ignores unsafe details", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/ai/memory?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.startsWith("/api/ai/playbooks?")) return new Response(JSON.stringify([{ playbookId: "pb1", version: 2, score: 4, reasons: ["context"], requiredContext: ["TASK"] }]), { status: 200 });
      if (url.includes("/pb1/versions")) return new Response(JSON.stringify({ versions: [{ id: "v2", playbookId: "pb1", version: 2, name: "Safe workflow", description: "Bounded description", scope: "TEAM", ownerId: "u1", departmentId: null, requiredContext: ["TASK"], allowedCapabilities: ["learning.memory.search"], state: "APPROVED", checksum: "abc123" }, { id: "bad", playbookId: "pb1", version: 3, name: "<script>bad</script>", description: "bad", scope: "TEAM", requiredContext: ["TASK"], allowedCapabilities: ["x"], state: "APPROVED", checksum: "x" , normalizedInstructions: "private" }] }), { status: 200 });
      throw new Error("unexpected request");
    });
    render(<SabahProvider><LearningShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load learning context" }));
    expect(await screen.findByText("Safe workflow")).toBeTruthy();
    expect(screen.getByText("Bounded description")).toBeTruthy();
    expect(screen.queryByText("<script>bad</script>")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/ai/playbooks?query=TASK%20t1&limit=5"));
  });

  it("reports a partial learning context when one branch fails but keeps valid cards", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/ai/memory?")) return new Response(JSON.stringify({ items: [{ id: "m1", scope: "TEAM", kind: "FACT", content: "Valid memory", provenance: "USER_PROVIDED", confidence: 0.8, freshness: "FRESH", expiresAt: null, ownerId: null, departmentId: null, sources: [] }] }), { status: 200 });
      if (url.startsWith("/api/ai/playbooks?")) return new Response("down", { status: 503 });
      throw new Error("unexpected request");
    });
    render(<SabahProvider><LearningShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load learning context" }));
    expect(await screen.findByText("Valid memory")).toBeTruthy();
    expect(screen.getByText("Learning context partially unavailable.")).toBeTruthy();
  });

  it("reports unavailable learning context when a matched version detail is malformed", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/ai/memory?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.startsWith("/api/ai/playbooks?")) return new Response(JSON.stringify([{ playbookId: "pb1" }]), { status: 200 });
      if (url.includes("/pb1/versions")) return new Response(JSON.stringify({ versions: [{ id: "bad", playbookId: "pb1", version: 1, name: "", description: "bad", scope: "TEAM", ownerId: "u1", requiredContext: ["TASK"], allowedCapabilities: ["x"], state: "APPROVED", checksum: "x" }] }), { status: 200 });
      throw new Error("unexpected request");
    });
    render(<SabahProvider><LearningShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load learning context" }));
    expect(await screen.findByText("Learning context unavailable.")).toBeTruthy();
  });

  it("discards foreign playbook versions and reports unavailable detail loading", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/ai/memory?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.startsWith("/api/ai/playbooks?")) return new Response(JSON.stringify([{ playbookId: "pb1" }]), { status: 200 });
      if (url.includes("/pb1/versions")) return new Response(JSON.stringify({ versions: [{ id: "foreign-v1", playbookId: "pb2", version: 1, name: "Foreign workflow", description: "Should not render", scope: "TEAM", ownerId: "u1", requiredContext: ["TASK"], allowedCapabilities: ["x"], state: "APPROVED", checksum: "foreign" }] }), { status: 200 });
      throw new Error("unexpected request");
    });
    render(<SabahProvider><LearningShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load learning context" }));
    expect(await screen.findByText("Learning context unavailable.")).toBeTruthy();
    expect(screen.queryByText("Foreign workflow")).toBeNull();
  });

  it("keeps healthy empty learning neutral without a form source", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/ai/memory?")) return new Response(JSON.stringify({ items: [], reviewIds: [] }), { status: 200 });
      if (url.startsWith("/api/ai/playbooks?")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error("unexpected request");
    });
    render(<SabahProvider><EmptyLearningShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load empty learning context" }));
    expect(await screen.findByText("No context attached to this conversation.")).toBeTruthy();
    expect(screen.queryByText("Learning context partially unavailable.")).toBeNull();
    expect(screen.queryByText("Learning context unavailable.")).toBeNull();
  });

  it("keeps review-only empty learning degraded, not unavailable, without a form source", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/ai/memory?")) return new Response(JSON.stringify({ items: [], reviewIds: ["m1"] }), { status: 200 });
      if (url.startsWith("/api/ai/playbooks?")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error("unexpected request");
    });
    render(<SabahProvider><EmptyLearningShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load empty learning context" }));
    expect(await screen.findByText("Learning context partially unavailable.")).toBeTruthy();
    expect(screen.queryByText("Learning context unavailable.")).toBeNull();
  });

  it("accepts all 200 compatible review IDs as degraded metadata", async () => {
    const reviewIds = Array.from({ length: 200 }, (_, index) => `m${index}`);
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/ai/memory?")) return new Response(JSON.stringify({ items: [], reviewIds }), { status: 200 });
      if (url.startsWith("/api/ai/playbooks?")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error("unexpected request");
    });
    render(<SabahProvider><EmptyLearningShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load empty learning context" }));
    expect(await screen.findByText("Learning context partially unavailable.")).toBeTruthy();
    expect(screen.queryByText("Learning context unavailable.")).toBeNull();
  });

  it("reports a memory route outage as unavailable without a form source", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/ai/memory?")) return new Response("down", { status: 503 });
      if (url.startsWith("/api/ai/playbooks?")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error("unexpected request");
    });
    render(<SabahProvider><EmptyLearningShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load empty learning context" }));
    expect(await screen.findByText("Learning context unavailable.")).toBeTruthy();
    expect(screen.queryByText("No context attached to this conversation.")).toBeNull();
  });

  it("reports an overbound review-ID response as unavailable instead of treating it as healthy empty", async () => {
    const reviewIds = Array.from({ length: 201 }, (_, index) => `m${index}`);
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/ai/memory?")) return new Response(JSON.stringify({ items: [], reviewIds }), { status: 200 });
      if (url.startsWith("/api/ai/playbooks?")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error("unexpected request");
    });
    render(<SabahProvider><EmptyLearningShellHarness /></SabahProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Load empty learning context" }));
    expect(await screen.findByText("Learning context unavailable.")).toBeTruthy();
    expect(screen.queryByText("No context attached to this conversation.")).toBeNull();
  });
});
