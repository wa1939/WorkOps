/**
 * Default pipeline stages materialized when an admin bootstraps a project's
 * pipeline. Kept as a single exported constant so future Playbooks (Wave 4+)
 * can reuse the exact same shape when generating stages from templates.
 */
export interface DefaultStage {
    name: string;
    color: string;
    order: number;
}

export const DEFAULT_PROJECT_STAGES: DefaultStage[] = [
    { name: "Kickoff", color: "#64748b", order: 0 },
    { name: "Planning", color: "#3b82f6", order: 1 },
    { name: "Execution", color: "#8b5cf6", order: 2 },
    { name: "Review", color: "#f59e0b", order: 3 },
    { name: "Wrap-up", color: "#10b981", order: 4 },
];

/** Column key used for tasks that have no stage yet (stageId === null). */
export const NO_STAGE_KEY = "__none__";
