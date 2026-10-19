export const PMO_HISTORY_KEY = "cee:pmo-history:v1";

const MAX_HISTORY = 20;
const VALIDATION_ORIGIN = "https://pmo.local";

export type PmoHistoryEntry = {
    url: string;
    kind: "pmo" | "external-action";
};

function normalizePmoHistoryEntry(entry: unknown): PmoHistoryEntry | null {
    if (!entry || typeof entry !== "object") return null;

    const candidate = entry as Partial<PmoHistoryEntry>;
    if (
        candidate.kind !== "pmo" &&
        candidate.kind !== "external-action"
    ) {
        return null;
    }
    if (
        typeof candidate.url !== "string" ||
        !candidate.url.startsWith("/") ||
        candidate.url.startsWith("//")
    ) {
        return null;
    }

    let parsed: URL;
    try {
        parsed = new URL(candidate.url, VALIDATION_ORIGIN);
    } catch {
        return null;
    }
    if (parsed.origin !== VALIDATION_ORIGIN) return null;

    let decodedPathname: string;
    try {
        decodedPathname = decodeURIComponent(parsed.pathname);
    } catch {
        return null;
    }
    if (decodedPathname.startsWith("//")) return null;

    const allowed =
        candidate.kind === "pmo"
            ? decodedPathname === "/pmo" ||
              decodedPathname.startsWith("/pmo/")
            : /^\/tasks\/[^/]+$/.test(decodedPathname);
    if (!allowed) return null;

    return {
        kind: candidate.kind,
        url: `${parsed.pathname}${parsed.search}`,
    };
}

export function sanitizePmoHistory(value: unknown): PmoHistoryEntry[] {
    if (!Array.isArray(value)) return [];

    const history: PmoHistoryEntry[] = [];
    for (const entry of value) {
        const normalized = normalizePmoHistoryEntry(entry);
        if (!normalized || history.at(-1)?.url === normalized.url) continue;
        history.push(normalized);
    }
    return history.slice(-MAX_HISTORY);
}

export function appendPmoHistory(
    history: PmoHistoryEntry[],
    entry: PmoHistoryEntry,
): PmoHistoryEntry[] {
    const clean = sanitizePmoHistory(history);
    const normalized = normalizePmoHistoryEntry(entry);
    if (!normalized || clean.at(-1)?.url === normalized.url) return clean;
    return [...clean, normalized].slice(-MAX_HISTORY);
}

export function popPreviousPmoUrl(
    history: PmoHistoryEntry[],
    currentUrl: string,
): { url: string; history: PmoHistoryEntry[] } {
    const clean = sanitizePmoHistory(history);
    const currentWithoutHash = currentUrl.split("#", 1)[0];
    if (clean.at(-1)?.url === currentWithoutHash) clean.pop();
    return { url: clean.at(-1)?.url ?? "/pmo", history: clean };
}
