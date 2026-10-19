export function groupTasksByStatus<T extends { status: string }>(
    tasks: readonly T[],
    statuses: readonly string[],
): Map<string, T[]> {
    const grouped = new Map<string, T[]>(statuses.map((status) => [status, []]));
    for (const task of tasks) {
        grouped.get(task.status)?.push(task);
    }
    return grouped;
}
