export class DependencyValidationError extends Error { constructor(message: string, public readonly code = "INVALID_DEPENDENCY") { super(message); this.name = "DependencyValidationError"; } }

type Edge = { taskId: string; dependsOnId: string };
export function assertNoDuplicateIds(ids: string[], label = "references") { if (new Set(ids).size !== ids.length) throw new DependencyValidationError(`Duplicate ${label}` , "DUPLICATE"); }
export function assertAcyclic(taskId: string, dependencyIds: string[], existing: Edge[]) {
  if (dependencyIds.includes(taskId)) throw new DependencyValidationError("Task cannot depend on itself", "CYCLE");
  const graph = new Map<string, string[]>();
  for (const e of existing) graph.set(e.taskId, [...(graph.get(e.taskId) ?? []), e.dependsOnId]);
  graph.set(taskId, [...(graph.get(taskId) ?? []), ...dependencyIds]);
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); for (const next of graph.get(id) ?? []) if (visit(next)) return true; visiting.delete(id); visited.add(id); return false; };
  if (visit(taskId)) throw new DependencyValidationError("Dependency cycle detected", "CYCLE");
}
export async function validateDependencies(tx: any, taskId: string, dependencyIds: string[]) {
  assertNoDuplicateIds(dependencyIds, "dependencies");
  if (dependencyIds.includes(taskId)) throw new DependencyValidationError("Task cannot depend on itself", "CYCLE");
  const refs = await tx.task.findMany({ where: { id: { in: [taskId, ...dependencyIds] } }, select: { id: true } });
  if (refs.length !== new Set([taskId, ...dependencyIds]).size) throw new DependencyValidationError("Referenced task not found", "INVALID_REFERENCE");
  const existing = await tx.taskDependency.findMany({ select: { taskId: true, dependsOnId: true } });
  if (existing.some((edge: Edge) => edge.taskId === taskId && dependencyIds.includes(edge.dependsOnId))) throw new DependencyValidationError("Dependency edge already exists", "DUPLICATE");
  assertAcyclic(taskId, dependencyIds, existing);
}

/** Validate all dependency references and graph constraints without writing. */
export async function preflightDependencies(tx: any, taskId: string, dependencyIds: string[]) {
  assertNoDuplicateIds(dependencyIds, "dependencies");
  if (!dependencyIds.length) return;
  const refs = await tx.task.findMany({ where: { id: { in: dependencyIds } }, select: { id: true } });
  if (refs.length !== new Set(dependencyIds).size) throw new DependencyValidationError("Referenced task not found", "INVALID_REFERENCE");
  const existing = await tx.taskDependency.findMany({ select: { taskId: true, dependsOnId: true } });
  assertAcyclic(taskId, dependencyIds, existing);
}
