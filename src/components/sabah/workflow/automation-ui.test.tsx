// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import "../test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BackgroundJobs, nextPollingDelay } from "./background-jobs";
import { SpecialistActivity } from "./specialist-activity";
import { SabahConnectors } from "../../admin/sabah-connectors";

describe("automation status UI", () => {
  it("shows only safe actor-owned job projections and supports cancel", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ job: { id: "job-1", type: "WORKFLOW_STEP", status: "RUNNING", retryCount: 1, maxAttempts: 3, checkpoint: "Validated", correlationId: "corr-1", recovery: "Retry available" } }) });
    const user = userEvent.setup();
    render(<BackgroundJobs fetcher={fetcher} statusUrls={[{ id: "job-1", url: "/api/ai/jobs/job-1" }]} tick={false} />);
    await waitFor(() => expect(screen.getByText(/Validated/)).toBeVisible());
    expect(screen.getByText(/corr-1/)).toBeVisible();
    expect(screen.getByText(/Retry available/)).toBeVisible();
    expect(screen.queryByText(/payload|secret|token/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /stop/i }));
    expect(fetcher).toHaveBeenCalledWith("/api/ai/jobs/job-1/cancel", expect.objectContaining({ method: "POST" }));
  });

  it("renders specialist activity without executing capabilities", () => {
    render(<SpecialistActivity items={[{ id: "a1", specialist: "Planner", status: "RUNNING", checkpoint: "Drafted plan", correlationId: "corr-7", recovery: "Resume from checkpoint" }]} />);
    expect(screen.getByText(/Drafted plan/)).toBeVisible();
    expect(screen.getByText(/Resume from checkpoint/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /run|execute/i })).not.toBeInTheDocument();
  });

  it("renders a configuration form with a masked credential and clears it after save", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ connectors: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SabahConnectors />);
    expect(screen.getByLabelText("Credential")).toHaveAttribute("type", "password");
    await user.type(screen.getByLabelText("Connector key"), "acme.tasks");
    await user.type(screen.getByLabelText("Kind"), "webhook");
    await user.type(screen.getByLabelText("Capability"), "tasks.read");
    await user.type(screen.getByLabelText("Credential"), "secret-value");
    await user.click(screen.getByRole("button", { name: /save connector/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/ai/connectors", expect.objectContaining({ method: "POST" })));
    expect(screen.getByLabelText("Credential")).toHaveValue("");
    vi.unstubAllGlobals();
  });

  it("uses bounded slower polling while the document is hidden", () => {
    expect(nextPollingDelay(0, false)).toBe(2000);
    expect(nextPollingDelay(0, true)).toBe(30000);
    expect(nextPollingDelay(99, true)).toBe(960000);
    expect(nextPollingDelay(Number.NaN, false)).toBe(2000);
  });
});
