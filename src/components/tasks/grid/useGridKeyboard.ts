import { useCallback } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export type GridKeyAction =
    | "next"
    | "previous"
    | "open"
    | "toggle-select"
    | "edit-title"
    | "cancel-edit"
    | "none";

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

type GridKeyboardTarget = EventTarget & {
    tagName?: string;
    isContentEditable?: boolean;
};

export function isGridTypingTarget(target: EventTarget | null): boolean {
    if (!target) return false;
    const element = target as GridKeyboardTarget;
    return element.isContentEditable === true || TYPING_TAGS.has(element.tagName ?? "");
}

export function mapGridKey(
    event: Pick<KeyboardEvent, "key" | "target">,
): GridKeyAction {
    if (isGridTypingTarget(event.target)) return "none";

    switch (event.key) {
        case "j":
            return "next";
        case "k":
            return "previous";
        case "Enter":
            return "open";
        case " ":
        case "Spacebar":
            return "toggle-select";
        case "e":
        case "E":
            return "edit-title";
        case "Escape":
            return "cancel-edit";
        default:
            return "none";
    }
}

export interface UseGridKeyboardOptions {
    rowId: string;
    rowIds: readonly string[];
    onOpen: () => void;
    onToggleSelection: () => void;
    onStartEdit: () => void;
    onCancelEdit?: () => void;
    onFocusRow?: (rowId: string) => void;
}

function focusGridRow(rowId: string): void {
    if (typeof document === "undefined") return;
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-grid-row]"))
        .find((candidate) => candidate.dataset.gridRowId === rowId);
    row?.focus();
}

export function useGridKeyboard({
    rowId,
    rowIds,
    onOpen,
    onToggleSelection,
    onStartEdit,
    onCancelEdit,
    onFocusRow,
}: UseGridKeyboardOptions) {
    const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
        const action = mapGridKey(event);
        if (action === "none") return;

        if (action === "next" || action === "previous") {
            const currentIndex = rowIds.indexOf(rowId);
            if (currentIndex < 0) return;
            const offset = action === "next" ? 1 : -1;
            const targetIndex = Math.max(0, Math.min(rowIds.length - 1, currentIndex + offset));
            const targetId = rowIds[targetIndex];
            if (!targetId || targetId === rowId) return;
            event.preventDefault();
            onFocusRow?.(targetId);
            focusGridRow(targetId);
            return;
        }

        event.preventDefault();
        if (action === "open") onOpen();
        if (action === "toggle-select") onToggleSelection();
        if (action === "edit-title") onStartEdit();
        if (action === "cancel-edit") onCancelEdit?.();
    }, [
        onCancelEdit,
        onFocusRow,
        onOpen,
        onStartEdit,
        onToggleSelection,
        rowId,
        rowIds,
    ]);

    return { onKeyDown };
}
