// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import "../sabah/test/setup";
import { render, screen } from "@testing-library/react";
import { WorkloadBreakdown } from "./workload-breakdown";

describe("WorkloadBreakdown", () => {
    it("shows unknown not zero", () => {
        render(
            <WorkloadBreakdown
                personName="Amina Noor"
                plannedHours={0}
                availableHours={35}
                percent={0}
                state="unestimated"
                unknownTasks={1}
            />,
        );

        expect(screen.getByTestId("estimate-warning")).toHaveTextContent("Estimate needed");
        expect(screen.queryByText("0%")).not.toBeInTheDocument();
    });

    it("shows true overload not capped", () => {
        render(
            <WorkloadBreakdown
                personName="Amina Noor"
                plannedHours={82}
                availableHours={35}
                percent={233}
                state="overloaded"
                unknownTasks={0}
            />,
        );

        expect(screen.getByTestId("workload-state")).toHaveTextContent("233%");
        expect(screen.queryByText("200%")).not.toBeInTheDocument();
    });

    it("zero capacity reads no available hours", () => {
        render(
            <WorkloadBreakdown
                personName="Amina Noor"
                plannedHours={5}
                availableHours={0}
                percent={null}
                state="no-capacity"
                unknownTasks={0}
            />,
        );

        expect(screen.getByTestId("workload-state")).toHaveTextContent("No available hours");
        expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    });

    it("mobile list has all contributors", () => {
        render(
            <div data-testid="contributors" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[
                    ["Amina Noor", 10],
                    ["Bilal Hamdan", 20],
                    ["Celine Faris", 30],
                ].map(([name, plannedHours]) => (
                    <WorkloadBreakdown
                        key={name}
                        personName={String(name)}
                        plannedHours={Number(plannedHours)}
                        availableHours={35 - Number(plannedHours)}
                        percent={Math.round((Number(plannedHours) / 35) * 100)}
                        state="available"
                        unknownTasks={0}
                    />
                ))}
            </div>,
        );

        expect(screen.getByTestId("contributors")).toHaveClass("grid-cols-1");
        for (const name of ["Amina Noor", "Bilal Hamdan", "Celine Faris"]) {
            expect(screen.getByText(name)).toBeVisible();
        }
    });

    it("last updated and confidence visible", () => {
        render(
            <WorkloadBreakdown
                personName="Amina Noor"
                plannedHours={12}
                availableHours={23}
                percent={34}
                state="available"
                unknownTasks={0}
                confidence="High confidence"
                computedAt="2026-09-07T08:30:00.000Z"
            />,
        );

        expect(screen.getByTestId("freshness")).toHaveTextContent("Last updated");
        expect(screen.getByTestId("freshness")).toHaveTextContent("High confidence");
    });
});
