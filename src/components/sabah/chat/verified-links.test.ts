import { describe, expect, it } from "vitest";
import { isInternalWorkflowHref } from "@/lib/sabah/workflows/schemas";
import { appendVerifiedHrefs, collectVerifiedInternalHrefs } from "./verified-links";

it("classifies absolute same-origin app links as internal, not an external-link escape", () => {
    expect(isInternalWorkflowHref("https://workops.test/tasks/fake", "https://workops.test")).toBe(true);
    expect(isInternalWorkflowHref("https://docs.example.test/tasks/fake", "https://workops.test")).toBe(false);
});

describe("collectVerifiedInternalHrefs", () => {
    it("rejects unnamed roots and uploaded rows even inside successful tool results", () => {
        expect(collectVerifiedInternalHrefs({ url: "/tasks/fake" })).toEqual([]);
        expect(collectVerifiedInternalHrefs({ ok: true, data: [{ id: "fake", url: "/tasks/fake" }] })).toEqual([]);
        expect(collectVerifiedInternalHrefs({ name: "getIntakeRows", result: { ok: true, data: {
            rows: [{ id: "fake", url: "/tasks/fake" }],
        } } })).toEqual([]);
    });

    it("uses canonical task projections only, never nested user content or mismatched IDs", () => {
        expect(collectVerifiedInternalHrefs({ name: "getTask", result: { ok: true, data: {
            id: "real", url: "/tasks/real", links: [{ href: "/tasks/fake" }],
        } } })).toEqual(["/tasks/real"]);
        expect(collectVerifiedInternalHrefs({ name: "getTask", result: { ok: true, data: {
            id: "real", url: "/tasks/invented",
        } } })).toEqual([]);
    });

    it("supports bounded task lists and authorized workspace source projections", () => {
        expect(collectVerifiedInternalHrefs([
            { name: "listMyTasks", result: { ok: true, data: { items: [{ id: "t1", url: "/tasks/t1" }], hasMore: true } } },
            { name: "workspaceSearch", result: { ok: true, data: { items: [{ source: {
                entityType: "PROJECT", entityId: "p1", href: "/projects/p1", label: "Project",
            }, snippet: { href: "/tasks/fake" } }] } } },
        ])).toEqual(["/tasks/t1", "/projects/p1"]);
    });

    it("collects internal url fields from successful tool result data", () => {
        const collected = collectVerifiedInternalHrefs({ name: "listMyTasks", result: {
            ok: true,
            data: [{ id: "t1", url: "/tasks/t1" }, { id: "t2", url: "/tasks/t2" }],
        } });

        expect(collected).toEqual(["/tasks/t1", "/tasks/t2"]);
    });

    it("reads persisted toolCalls entries and live SSE result envelopes alike", () => {
        const persisted = [{ name: "listMyTasks", params: {}, result: { ok: true, data: [{ id: "p1", url: "/tasks/p1" }] } }];
        const live = { name: "getTask", result: { ok: true, data: { id: "p2", url: "/tasks/p2" } } };

        expect(collectVerifiedInternalHrefs([...persisted, live])).toEqual(["/tasks/p1", "/tasks/p2"]);
    });

    it("ignores failed tool results so forged or failed tools cannot grant navigation authority", () => {
        expect(collectVerifiedInternalHrefs({ ok: false, error: "boom", data: [{ url: "/tasks/t1" }] })).toEqual([]);
        expect(collectVerifiedInternalHrefs({ name: "listMyTasks", result: { ok: false, error: "boom" } })).toEqual([]);
    });

    it("excludes external https links, scheme-relative, and unsafe hrefs", () => {
        const collected = collectVerifiedInternalHrefs({
            ok: true,
            data: [{ url: "https://example.test/x" }, { url: "//evil.example" }, { href: "javascript:alert(1)" }],
        });

        expect(collected).toEqual([]);
    });

    it("does not collect arbitrary string fields", () => {
        expect(collectVerifiedInternalHrefs({ ok: true, data: { text: "/tasks/t9", title: "/tasks/t10" } })).toEqual([]);
    });

    it("collects actor-verified workflow entityLinks from proposal snapshots", () => {
        const snapshot = { name: "proposeWorkflow", result: {
            ok: true,
            data: { steps: [{ entityLinks: [{ type: "TASK", id: "task-1", href: "/tasks/task-1", label: "Onboarding task" }] }] },
        } };

        expect(collectVerifiedInternalHrefs(snapshot)).toEqual(["/tasks/task-1"]);
    });

    it("tolerates junk input without throwing", () => {
        expect(collectVerifiedInternalHrefs(null)).toEqual([]);
        expect(collectVerifiedInternalHrefs("nonsense")).toEqual([]);
        expect(collectVerifiedInternalHrefs({ ok: true, data: { nested: { deeper: [{ url: 42 }] } } })).toEqual([]);
        expect(collectVerifiedInternalHrefs([{ result: undefined }, { result: { ok: true } }])).toEqual([]);
    });
});

describe("appendVerifiedHrefs", () => {
    it("returns a new set with hrefs appended, deduplicated", () => {
        const merged = appendVerifiedHrefs(new Set(["/tasks/a"]), ["/tasks/b", "/tasks/a"]);

        expect(Array.from(merged)).toEqual(["/tasks/a", "/tasks/b"]);
        expect(merged).not.toBe(new Set(["/tasks/a"]));
    });

    it("caps the set so unbounded tool output cannot grow it forever", () => {
        let set = new Set<string>();
        set = appendVerifiedHrefs(set, Array.from({ length: 20 }, (_, index) => `/tasks/t${index}`), 10);

        expect(set.size).toBe(10);
        expect(set.has("/tasks/t0")).toBe(false);
        expect(set.has("/tasks/t19")).toBe(true);
    });
});
