export const AUTHZ_ACTIONS = [
    "task:view",
    "task:edit",
    "task:delete",
    "project:view",
    "project:edit",
    "project:manage",
    "comment:edit",
    "timelog:edit",
    "planner:edit",
] as const;

export type AuthzAction = (typeof AUTHZ_ACTIONS)[number];

export type AuthzRole = "ADMIN" | "MANAGER" | "MEMBER" | "VIEWER";
export type ProjectAccessLevel = AuthzRole;

export interface AuthzUser {
    id: string;
    role?: string | null;
}

export interface ProjectMembership {
    projectId?: string | null;
    userId?: string | null;
    accessLevel?: ProjectAccessLevel | string | null;
}

export interface TaskMembership extends ProjectMembership {
    taskId?: string | null;
    taskOwnerId?: string | null;
    ownerId?: string | null;
    createdById?: string | null;
    taskAssigneeIds?: readonly string[];
    assigneeIds?: readonly string[];
    assignedUserIds?: readonly string[];
    isOwner?: boolean;
}

export interface CommentMembership extends ProjectMembership {
    commentId?: string | null;
    authorId?: string | null;
    commentAuthorId?: string | null;
    commentOwnerId?: string | null;
}

export interface TimeLogMembership extends ProjectMembership {
    timeLogId?: string | null;
    authorId?: string | null;
    timeLogAuthorId?: string | null;
    ownerId?: string | null;
    createdById?: string | null;
}

export type AuthzResourceKind = "task" | "project" | "comment" | "timelog";

type ResourceDescriptor<K extends AuthzResourceKind> =
    | { type: K; id: string }
    | { kind: K; id: string };

export type TaskResource = ResourceDescriptor<"task">;
export type ProjectResource = ResourceDescriptor<"project">;
export type CommentResource = ResourceDescriptor<"comment">;
export type TimeLogResource = ResourceDescriptor<"timelog">;
export type AuthzResource = TaskResource | ProjectResource | CommentResource | TimeLogResource;

export type AuthzRouteContext = {
    params?: Record<string, string | string[]> | Promise<Record<string, string | string[]>>;
};

export type AuthzResourceResolver = (
    request: Request,
    context: AuthzRouteContext,
) => AuthzResource | null | Promise<AuthzResource | null>;

export type AuthzRouteHandler = (
    request: Request,
    context: AuthzRouteContext,
    sessionUser: AuthzUser,
    resource: AuthzResource,
) => Response | Promise<Response>;
