export type Quarter = "Q1" | "Q2" | "Q3" | "Q4";

const ORDER: Quarter[] = ["Q1", "Q2", "Q3", "Q4"];

export function currentQuarter(d: Date = new Date()): Quarter {
    const m = d.getMonth();
    return m < 3 ? "Q1" : m < 6 ? "Q2" : m < 9 ? "Q3" : "Q4";
}

export function previousQuarter(q: Quarter): Quarter {
    return ORDER[(ORDER.indexOf(q) + 3) % 4];
}

export function nextQuarter(q: Quarter): Quarter {
    return ORDER[(ORDER.indexOf(q) + 1) % 4];
}

export function targetForQuarter(
    kpi: { q1Target: number | null; q2Target: number | null; q3Target: number | null; q4Target: number | null },
    q: Quarter,
): number | null {
    return q === "Q1" ? kpi.q1Target : q === "Q2" ? kpi.q2Target : q === "Q3" ? kpi.q3Target : kpi.q4Target;
}

export function daysRemainingInQuarter(d: Date = new Date()): number {
    const q = currentQuarter(d);
    const year = d.getFullYear();
    const endMonth = q === "Q1" ? 2 : q === "Q2" ? 5 : q === "Q3" ? 8 : 11;
    const endOfQuarter = new Date(year, endMonth + 1, 0);
    const diffMs = endOfQuarter.getTime() - d.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}
