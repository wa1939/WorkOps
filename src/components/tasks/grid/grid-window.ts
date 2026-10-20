const WINDOW_SIZE = 200;

/** Bound DOM size without making older loaded tasks unreachable. */
export function taskGridWindow<T>(rows: readonly T[], requestedPage: number) {
    const pages = Math.max(1, Math.ceil(rows.length / WINDOW_SIZE));
    const page = Math.min(Math.max(0, Math.floor(requestedPage) || 0), pages - 1);
    const start = page * WINDOW_SIZE;
    return { page, pages, start, rows: rows.slice(start, start + WINDOW_SIZE) };
}
