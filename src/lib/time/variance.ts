export type VarianceState = "under" | "over" | "on";

export interface TimeVariance {
    loggedHours: number;
    estimateHours: number;
    deltaHours: number;
    ratio: number;
    state: VarianceState;
}

/** Compare logged time with an estimate; a positive delta means the estimate was exceeded. */
export function variance(estimateMinutes: number, loggedMinutes: number): TimeVariance {
    const loggedHours = loggedMinutes / 60;
    const estimateHours = estimateMinutes / 60;
    const deltaHours = loggedHours - estimateHours;
    const ratio = estimateMinutes === 0
        ? loggedMinutes === 0 ? 1 : Infinity
        : loggedMinutes / estimateMinutes;
    const state: VarianceState = deltaHours > 0 ? "over" : deltaHours < 0 ? "under" : "on";

    return { loggedHours, estimateHours, deltaHours, ratio, state };
}
