import {
    appendPmoHistory,
    PMO_HISTORY_KEY,
    popPreviousPmoUrl,
    sanitizePmoHistory,
    type PmoHistoryEntry,
} from "./navigation-history";

export type PmoNavigationStorage = Pick<
    Storage,
    "getItem" | "setItem"
>;

export function getPmoSessionStorage(): PmoNavigationStorage | null {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

function readHistory(storage: PmoNavigationStorage): PmoHistoryEntry[] {
    const raw = storage.getItem(PMO_HISTORY_KEY);
    if (!raw) return [];
    try {
        return sanitizePmoHistory(JSON.parse(raw));
    } catch {
        return [];
    }
}

export function recordPmoVisit(
    storage: PmoNavigationStorage,
    entry: PmoHistoryEntry,
): void {
    try {
        const history = appendPmoHistory(readHistory(storage), entry);
        storage.setItem(PMO_HISTORY_KEY, JSON.stringify(history));
    } catch {
        // Browser privacy settings may block session storage.
    }
}

export function takePmoBackDestination(
    storage: PmoNavigationStorage,
    currentUrl: string,
): string {
    try {
        const result = popPreviousPmoUrl(readHistory(storage), currentUrl);
        storage.setItem(PMO_HISTORY_KEY, JSON.stringify(result.history));
        return result.url;
    } catch {
        return "/pmo";
    }
}
