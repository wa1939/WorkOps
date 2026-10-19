// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KPIUpdateDialog } from "./kpi-update-dialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/ui/badge", () => ({ Badge: () => null }));

describe("KPIUpdateDialog", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
    });

    it("submits the authoritative KPI version with the score", async () => {
        render(<KPIUpdateDialog open onOpenChange={vi.fn()} kpiId="kpi-1" kpiName="Quality" quarter="Q1" target={100} expectedUpdatedAt="2026-09-02T12:00:00.000Z" />);

        fireEvent.change(screen.getByLabelText(/Actual Value/i), { target: { value: "80" } });
        fireEvent.click(screen.getByRole("button", { name: "Submit Update" }));

        await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/kpis/kpi-1/update", expect.objectContaining({
            body: JSON.stringify({ value: 80, quarter: "Q1", expectedUpdatedAt: "2026-09-02T12:00:00.000Z" }),
        })));
    });
});