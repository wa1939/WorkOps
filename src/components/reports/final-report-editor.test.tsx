// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import "../sabah/test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinalReportEditor } from "./final-report-editor";

const toast = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

describe("FinalReportEditor learning copy", () => {
    it("describes both writing style and selection judgment honestly", () => {
        render(<FinalReportEditor reportId="report-1" initialFinal="Final report" submittedAt={null} styleMemo={null} />);
        expect(screen.getByText(/which work you choose to include, merge, or leave out/i)).toBeInTheDocument();
        expect(screen.getByText(/style and selection/i)).toBeInTheDocument();
    });

    it("describes learning as conditional and discloses when it was not recorded", async () => {
        const user = userEvent.setup();
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ success: true, learned: false }), { status: 200, headers: { "content-type": "application/json" } }));
        render(<FinalReportEditor reportId="report-1" initialFinal="Final report" submittedAt={null} styleMemo={null} />);
        expect(screen.getByText(/try to learn/i)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /submit.*try.*learn/i }));
        expect(fetchSpy).toHaveBeenCalledWith("/api/reports/report-1/final", expect.objectContaining({ body: JSON.stringify({ finalBody: "Final report", approved: true, learn: true }) }));
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringMatching(/learning was not recorded/i) }));
        fetchSpy.mockRestore();
    });

    it("reports the proposal id when finalization creates a pending style proposal", async () => {
        const user = userEvent.setup();
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ success: true, learned: false, learningProposalId: "proposal-7" }), { status: 200, headers: { "content-type": "application/json" } }));
        render(<FinalReportEditor reportId="report-1" initialFinal="Final report" submittedAt={null} styleMemo={null} />);
        await user.click(screen.getByRole("button", { name: /submit.*try.*learn/i }));
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringMatching(/proposal-7|pending/i) }));
        fetchSpy.mockRestore();
    });
});
