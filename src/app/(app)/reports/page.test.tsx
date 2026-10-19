// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import "../../../components/sabah/test/setup";
import { render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  toSabahActor: vi.fn(),
  searchReports: vi.fn(),
  getReportHistoryForActor: vi.fn(),
  getReportStyleProposalsForActor: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/sabah/auth/actor", () => ({ toSabahActor: mocks.toSabahActor }));
vi.mock("@/lib/reports/commands", () => ({ searchReports: mocks.searchReports }));
vi.mock("@/lib/reports/history", () => ({ getReportHistoryForActor: mocks.getReportHistoryForActor, getReportStyleProposalsForActor: mocks.getReportStyleProposalsForActor }));
vi.mock("@/components/sunday-digest-send-button", () => ({ SundayDigestSendButton: () => <button type="button">Digest button</button> }));
vi.mock("@/components/generate-report-button", () => ({ GenerateReportButton: () => <button type="button">Generate button</button> }));
vi.mock("@/components/reports/report-history-bootstrap", () => ({ ReportHistoryBootstrap: () => <div>History bootstrap</div> }));
vi.mock("@/components/ui/empty-state", () => ({ EmptyState: ({ actions = [] }: { actions?: Array<{ label: string }> }) => <div>{actions.map((action) => <span key={action.label}>{action.label}</span>)}</div> }));

import ReportsPage from "./page";

it("does not render the digest send control from a stale JWT admin role", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "jwt-user", role: "ADMIN" } });
  mocks.toSabahActor.mockResolvedValue({ id: "db-user", role: "MEMBER", departmentIds: [] });
  mocks.searchReports.mockResolvedValue([]);
  mocks.getReportHistoryForActor.mockResolvedValue([]);
  mocks.getReportStyleProposalsForActor.mockResolvedValue([]);

  render(await ReportsPage());

  expect(screen.queryByRole("button", { name: "Digest button" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Generate button" })).toBeInTheDocument();
});
