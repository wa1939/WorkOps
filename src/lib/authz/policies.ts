import {
    AUTHZ_ACTIONS,
    type AuthzAction,
    type AuthzUser,
    type CommentMembership,
    type ProjectMembership,
    type TaskMembership,
    type TimeLogMembership,
} from "./types";

const KNOWN_ACTIONS: ReadonlySet<string> = new Set(AUTHZ_ACTIONS);
const ACCESS_LEVELS = new Set(["ADMIN", "MANAGER", "MEMBER", "VIEWER"]);

type PolicyMembership = ProjectMembership | TaskMembership | CommentMembership | TimeLogMembership;

function isKnownAction(action: string): action is AuthzAction {
    return KNOWN_ACTIONS.has(action);
}

function isValidUser(user: AuthzUser | null | undefined): user is AuthzUser {
    return typeof user?.id === "string" && user.id.length > 0;
}

function accessLevel(membership: PolicyMembership | null | undefined): string | null {
    const value = membership?.accessLevel;
    return typeof value === "string" && ACCESS_LEVELS.has(value) ? value : null;
}

function beginPolicy(
    user: AuthzUser | null | undefined,
    membership: PolicyMembership | null | undefined,
    action: string,
): { isAdmin: boolean; accessLevel: string | null } | null {
    if (!isKnownAction(action) || !isValidUser(user)) {
        return null;
    }

    if (user.role === "ADMIN") {
        return { isAdmin: true, accessLevel: null };
    }

    const level = accessLevel(membership);
    if (level) {
        return { isAdmin: false, accessLevel: level };
    }
    // Standalone tasks (no project membership) remain reachable for the
    // task's own creator/assignees, evaluated by the task policy below.
    // Returning null here would deny them outright. Project/comment/timelog
    // policies still treat the null level as absent membership.
    if (String(action).startsWith("task:")) {
        return { isAdmin: false, accessLevel: null };
    }
    return null;
}

function isTaskOwner(user: AuthzUser, membership: TaskMembership | null | undefined): boolean {
    if (!membership) {
        return false;
    }
    if (membership.isOwner === true) {
        return true;
    }

    const ownerIds = [membership.taskOwnerId, membership.ownerId, membership.createdById];
    if (ownerIds.some((ownerId) => ownerId === user.id)) {
        return true;
    }

    const assigneeIds = [
        ...(membership.taskAssigneeIds ?? []),
        ...(membership.assigneeIds ?? []),
        ...(membership.assignedUserIds ?? []),
    ];
    return assigneeIds.includes(user.id);
}

function isAuthor(
    user: AuthzUser,
    membership: CommentMembership | TimeLogMembership | null | undefined,
): boolean {
    if (!membership) {
        return false;
    }
    const authorId = "authorId" in membership && membership.authorId
        ? membership.authorId
        : "commentAuthorId" in membership && membership.commentAuthorId
            ? membership.commentAuthorId
            : "timeLogAuthorId" in membership && membership.timeLogAuthorId
                ? membership.timeLogAuthorId
                : "createdById" in membership && membership.createdById
                    ? membership.createdById
                    : "ownerId" in membership
                        ? membership.ownerId
                        : null;

    return authorId === user.id;
}

/** Evaluate task permissions without performing I/O. */
export function evaluateTaskAccess(
    user: AuthzUser | null | undefined,
    membership: TaskMembership | null | undefined,
    action: AuthzAction | string,
): boolean {
    const decision = beginPolicy(user, membership, action);
    if (!decision || !isValidUser(user)) {
        return false;
    }
    if (decision.isAdmin) {
        return true;
    }

    switch (action) {
        case "task:view":
            return true;
        case "task:edit":
            return decision.accessLevel === "ADMIN"
                || decision.accessLevel === "MANAGER"
                || ((decision.accessLevel === "MEMBER" || decision.accessLevel === null) && isTaskOwner(user, membership));
        case "task:delete":
            // Standalone tasks: only the creator may delete them.
            return decision.accessLevel === "ADMIN"
                || decision.accessLevel === "MANAGER"
                || (decision.accessLevel === null && isTaskOwner(user, membership));
        default:
            return false;
    }
}

/** Evaluate project permissions without performing I/O. */
export function evaluateProjectAccess(
    user: AuthzUser | null | undefined,
    membership: ProjectMembership | null | undefined,
    action: AuthzAction | string,
): boolean {
    const decision = beginPolicy(user, membership, action);
    if (!decision) {
        return false;
    }
    if (decision.isAdmin) {
        return true;
    }

    switch (action) {
        case "project:view":
            return true;
        case "project:edit":
        case "project:manage":
        case "planner:edit":
            return decision.accessLevel === "ADMIN" || decision.accessLevel === "MANAGER";
        default:
            return false;
    }
}

/** Evaluate comment permissions without performing I/O. */
export function evaluateCommentAccess(
    user: AuthzUser | null | undefined,
    membership: CommentMembership | null | undefined,
    action: AuthzAction | string,
): boolean {
    const decision = beginPolicy(user, membership, action);
    if (!decision || !isValidUser(user)) {
        return false;
    }
    if (decision.isAdmin) {
        return true;
    }

    if (action !== "comment:edit") {
        return false;
    }

    return decision.accessLevel === "ADMIN"
        || decision.accessLevel === "MANAGER"
        || isAuthor(user, membership);
}

/** Evaluate time-log permissions without performing I/O. */
export function evaluateTimeLogAccess(
    user: AuthzUser | null | undefined,
    membership: TimeLogMembership | null | undefined,
    action: AuthzAction | string,
): boolean {
    const decision = beginPolicy(user, membership, action);
    if (!decision || !isValidUser(user)) {
        return false;
    }
    if (decision.isAdmin) {
        return true;
    }

    if (action !== "timelog:edit") {
        return false;
    }

    return decision.accessLevel === "ADMIN"
        || decision.accessLevel === "MANAGER"
        || isAuthor(user, membership);
}

export const AUTHZ_POLICY_MATRIX = [
    // Tasks — full accessLevel × action × ownership coverage
    { kind: "task", accessLevel: "ADMIN", action: "task:view", ownsTask: false, allowed: true },
    { kind: "task", accessLevel: "ADMIN", action: "task:edit", ownsTask: false, allowed: true },
    { kind: "task", accessLevel: "ADMIN", action: "task:delete", ownsTask: false, allowed: true },
    { kind: "task", accessLevel: "MANAGER", action: "task:view", ownsTask: false, allowed: true },
    { kind: "task", accessLevel: "MANAGER", action: "task:edit", ownsTask: false, allowed: true },
    { kind: "task", accessLevel: "MANAGER", action: "task:edit", ownsTask: true, allowed: true },
    { kind: "task", accessLevel: "MANAGER", action: "task:delete", ownsTask: false, allowed: true },
    { kind: "task", accessLevel: "MANAGER", action: "task:delete", ownsTask: true, allowed: true },
    { kind: "task", accessLevel: "MEMBER", action: "task:view", ownsTask: false, allowed: true },
    { kind: "task", accessLevel: "MEMBER", action: "task:view", ownsTask: true, allowed: true },
    { kind: "task", accessLevel: "MEMBER", action: "task:edit", ownsTask: true, allowed: true },
    { kind: "task", accessLevel: "MEMBER", action: "task:edit", ownsTask: false, allowed: false },
    { kind: "task", accessLevel: "MEMBER", action: "task:delete", ownsTask: true, allowed: false },
    { kind: "task", accessLevel: "MEMBER", action: "task:delete", ownsTask: false, allowed: false },
    { kind: "task", accessLevel: "VIEWER", action: "task:view", ownsTask: false, allowed: true },
    { kind: "task", accessLevel: "VIEWER", action: "task:view", ownsTask: true, allowed: true },
    { kind: "task", accessLevel: "VIEWER", action: "task:edit", ownsTask: true, allowed: false },
    { kind: "task", accessLevel: "VIEWER", action: "task:edit", ownsTask: false, allowed: false },
    { kind: "task", accessLevel: "VIEWER", action: "task:delete", ownsTask: true, allowed: false },
    { kind: "task", accessLevel: "VIEWER", action: "task:delete", ownsTask: false, allowed: false },
    // Projects — full accessLevel × action coverage
    { kind: "project", accessLevel: "ADMIN", action: "project:view", ownsTask: false, allowed: true },
    { kind: "project", accessLevel: "ADMIN", action: "project:edit", ownsTask: false, allowed: true },
    { kind: "project", accessLevel: "ADMIN", action: "project:manage", ownsTask: false, allowed: true },
    { kind: "project", accessLevel: "ADMIN", action: "planner:edit", ownsTask: false, allowed: true },
    { kind: "project", accessLevel: "MANAGER", action: "project:view", ownsTask: false, allowed: true },
    { kind: "project", accessLevel: "MANAGER", action: "project:edit", ownsTask: false, allowed: true },
    { kind: "project", accessLevel: "MANAGER", action: "project:manage", ownsTask: false, allowed: true },
    { kind: "project", accessLevel: "MANAGER", action: "planner:edit", ownsTask: false, allowed: true },
    { kind: "project", accessLevel: "MEMBER", action: "project:view", ownsTask: false, allowed: true },
    { kind: "project", accessLevel: "MEMBER", action: "project:edit", ownsTask: false, allowed: false },
    { kind: "project", accessLevel: "MEMBER", action: "project:manage", ownsTask: false, allowed: false },
    { kind: "project", accessLevel: "MEMBER", action: "planner:edit", ownsTask: false, allowed: false },
    { kind: "project", accessLevel: "VIEWER", action: "project:view", ownsTask: false, allowed: true },
    { kind: "project", accessLevel: "VIEWER", action: "project:edit", ownsTask: false, allowed: false },
    { kind: "project", accessLevel: "VIEWER", action: "project:manage", ownsTask: false, allowed: false },
    { kind: "project", accessLevel: "VIEWER", action: "planner:edit", ownsTask: false, allowed: false },
] as const;

export const POLICY_MATRIX = AUTHZ_POLICY_MATRIX;
export const policyMatrix = AUTHZ_POLICY_MATRIX;
