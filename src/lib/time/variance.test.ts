import { describe, expect, it } from "vitest";
import { variance } from "./variance";

describe("variance", () => {
    it("reports an under-estimate actual as under", () => {
        expect(variance(120, 90)).toEqual({
            loggedHours: 1.5,
            estimateHours: 2,
            deltaHours: -0.5,
            ratio: 0.75,
            state: "under",
        });
    });

    it("reports an over-estimate actual as over", () => {
        expect(variance(60, 90)).toEqual({
            loggedHours: 1.5,
            estimateHours: 1,
            deltaHours: 0.5,
            ratio: 1.5,
            state: "over",
        });
    });

    it("reports equal estimate and actual as on", () => {
        expect(variance(60, 60)).toEqual({
            loggedHours: 1,
            estimateHours: 1,
            deltaHours: 0,
            ratio: 1,
            state: "on",
        });
    });

    it("handles a zero-minute estimate without returning NaN", () => {
        expect(variance(0, 0)).toMatchObject({ ratio: 1, state: "on" });
        expect(variance(0, 30)).toMatchObject({ ratio: Infinity, state: "over" });
    });
});
