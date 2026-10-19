// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import "../sabah/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportHistoryBootstrap } from "./report-history-bootstrap";

const toast = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

describe("ReportHistoryBootstrap", () => {
  it("requires explicit approval and sends dated entries to the authenticated route", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true, importedCount: 1, replayedCount: 0, learned: false, memoryId: "proposal-boot" }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<ReportHistoryBootstrap history={[]} />);

    const date = screen.getByLabelText("History date 1");
    const content = screen.getByLabelText("History text 1");
    await user.type(date, "2026-08-16");
    await user.type(content, "Exact historical text");
    const submit = screen.getByRole("button", { name: /import approved history/i });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /approve using these dated reports/i }));
    await user.click(submit);

    const request = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({ approved: true, entries: [{ date: "2026-08-16", content: "Exact historical text" }] });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("proposal-boot") }));
    fetchSpy.mockRestore();
  });

  it("exposes pending proposals and sends explicit approve/reject decisions", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true, learned: true }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<ReportHistoryBootstrap history={[]} pendingProposals={[
      { id: "proposal-1", content: "صياغة: قاعدة معتمدة\nانتقاء: قاعدة معتمدة", provenance: "GENERATED" },
      { id: "proposal-2", content: "صياغة: قاعدة أخرى\nانتقاء: قاعدة أخرى", provenance: "GENERATED" },
    ]} />);

    expect(screen.getByText(/pending style proposals/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Decision reason proposal-1"), "Approve after review");
    await user.click(screen.getByRole("button", { name: /approve proposal-1/i }));
    await user.type(screen.getByLabelText("Decision reason proposal-2"), "Reject because it is too broad");
    await user.click(screen.getByRole("button", { name: /reject proposal-2/i }));

    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/api/reports/lessons/proposal-1/decision", expect.objectContaining({ body: JSON.stringify({ approved: true, reason: "Approve after review" }) }));
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/reports/lessons/proposal-2/decision", expect.objectContaining({ body: JSON.stringify({ approved: false, reason: "Reject because it is too broad" }) }));
    fetchSpy.mockRestore();
  });
});
