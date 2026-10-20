// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTaskGrid } from "./useTaskGrid";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/tasks", useSearchParams: () => new URLSearchParams() }));
afterEach(() => vi.unstubAllGlobals());
const response = (id: string, more = false) => new Response(JSON.stringify({ rows: [{ id }], groups: [], nextCursor: more ? { id, updatedAt: "2026-10-01T00:00:00Z" } : null }));
it("does not append a stale load-more page after the person filter changes", async () => {
    let finishOldPage!: (value: Response) => void;
    const oldPage = new Promise<Response>(resolve => { finishOldPage = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        const params = new URL(url, "http://local.test").searchParams;
        if (params.has("cursor")) return oldPage;
        return response(params.get("assigneeIds") === "other" ? "new-person-task" : "old-person-task", true);
    }));
    const { result, rerender, unmount } = renderHook(({ person }) => useTaskGrid({ filters: { assigneeIds: [person] } }), { initialProps: { person: "self" } });
    await waitFor(() => expect(result.current.rows[0]?.id).toBe("old-person-task"));
    act(() => { void result.current.loadMore(); });
    rerender({ person: "other" });
    await waitFor(() => expect(result.current.rows[0]?.id).toBe("new-person-task"));
    await act(async () => { finishOldPage(response("stale-task")); await oldPage; });
    expect(result.current.rows.map(row => row.id)).toEqual(["new-person-task"]);
    unmount();
});
