import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { searchConversationHistory, InvalidConversationSearchCursorError } from "@/lib/sabah/continuity/search";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/sabah/auth/actor", () => ({
  toSabahActor: vi.fn(),
  SabahForbiddenError: class extends Error { status = 403; code = "SABAH_FORBIDDEN"; },
}));
vi.mock("@/lib/sabah/continuity/search", () => ({
  searchConversationHistory: vi.fn(),
  ConversationNotFoundError: class extends Error {},
  InvalidConversationSearchCursorError: class extends Error {},
}));

type TestSession = { user: { id: string; role: string } } | null;
const authMock = vi.mocked(auth) as unknown as { mockResolvedValue: (value: TestSession) => unknown };

describe("conversation search route", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "MEMBER" } });
    vi.mocked(toSabahActor).mockResolvedValue({ id: "u1", role: "MEMBER", departmentIds: [] });
    vi.mocked(searchConversationHistory).mockResolvedValue({ items: [], hasMore: false, nextCursor: null, truncated: false });
  });

  it("returns unauthorized before invoking search", async () => {
    authMock.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/ai/conversations/search?q=hello"));
    expect(response.status).toBe(401);
    expect(searchConversationHistory).not.toHaveBeenCalled();
  });

  it("parses GET filters and caps limit at 50", async () => {
    await GET(new Request("http://localhost/api/ai/conversations/search?query=hello&conversationId=c1&workflowId=w1&before=2026-03-01&limit=500"));
    expect(searchConversationHistory).toHaveBeenCalledWith("hello", expect.objectContaining({ id: "u1" }), expect.anything(), expect.objectContaining({ conversationId: "c1", workflowId: "w1", limit: 50, before: new Date("2026-03-01") }));
  });

  it("maps malformed cursors to a client error", async () => {
    vi.mocked(searchConversationHistory).mockRejectedValue(new InvalidConversationSearchCursorError("bad cursor"));
    const response = await GET(new Request("http://localhost/api/ai/conversations/search?query=hello&cursor=bad"));
    expect(response.status).toBe(400);
  });

  it("supports POST JSON search and returns safe service response", async () => {
    vi.mocked(searchConversationHistory).mockResolvedValue({ items: [{ messageId: "m1", conversationId: "c1", title: "Chat", createdAt: "2026-01-01T00:00:00.000Z", role: "user", excerpt: "hello", highlight: "<mark>hello</mark>", workflowIds: [], cursor: "x" }], hasMore: false, nextCursor: null, truncated: false });
    const response = await POST(new Request("http://localhost/api/ai/conversations/search", { method: "POST", body: JSON.stringify({ query: "hello", limit: 1 }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [{ messageId: "m1" }], hasMore: false });
  });

  it("maps malformed POST JSON to a client error", async () => {
    const response = await POST(new Request("http://localhost/api/ai/conversations/search", { method: "POST", body: "{bad" }));
    expect(response.status).toBe(400);
  });
});
