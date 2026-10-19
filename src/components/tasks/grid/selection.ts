export interface SelectionModifiers {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
}

/** Return the inclusive visible-row range between two ids. */
export function computeSelectionRange(
    ids: readonly string[],
    anchor: string | null | undefined,
    target: string,
): string[] {
    const targetIndex = ids.indexOf(target);
    if (targetIndex < 0) return [];

    const anchorIndex = anchor == null ? -1 : ids.indexOf(anchor);
    if (anchorIndex < 0) return [target];

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    return ids.slice(start, end + 1);
}
