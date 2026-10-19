export type WorkspaceScopedReference = {
    workspaceId: string | null;
};

/**
 * A workspace scope remains transitional until the W03 backfill/enforcement
 * lands: legacy rows with a null workspaceId must stay visible to the selected
 * workspace under the existing legacy visibility rules.
 */
export function workspaceScopeWhere(workspaceId: string) {
    return {
        OR: [{ workspaceId }, { workspaceId: null }],
    };
}

export class WorkspaceScopeError extends Error {
    constructor(
        message: string,
        public readonly status = 400,
        public readonly code = "CROSS_WORKSPACE_REFERENCE",
    ) {
        super(message);
        this.name = "WorkspaceScopeError";
    }
}

/** Require every non-legacy reference to belong to the target workspace. */
export function requireSameWorkspace(
    workspaceId: string,
    refs: WorkspaceScopedReference[],
): true {
    for (const ref of refs) {
        // A null workspaceId is a legacy row and remains valid during the
        // transitional period before W03 backfills and enforces ownership.
        if (ref.workspaceId !== null && ref.workspaceId !== workspaceId) {
            throw new WorkspaceScopeError("Referenced record belongs to another workspace");
        }
    }
    return true;
}

/** Compose independent visibility predicates without spreading competing OR keys. */
export function composeScopes(...predicates: unknown[]): unknown {
    return {
        AND: predicates.filter((predicate) => predicate !== undefined && predicate !== null),
    };
}
