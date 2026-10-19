import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
    loadCommentContext,
    loadProjectContext,
    loadTaskContext,
    loadTimeLogContext,
} from "./fetchers";
import {
    AUTHZ_ACTIONS,
    type AuthzAction,
    type AuthzResource,
    type AuthzResourceKind,
    type AuthzResourceResolver,
    type AuthzRouteContext,
    type AuthzRouteHandler,
    type AuthzUser,
    type CommentMembership,
    type ProjectMembership,
    type TaskMembership,
    type TimeLogMembership,
} from "./types";
import {
    evaluateCommentAccess,
    evaluateProjectAccess,
    evaluateTaskAccess,
    evaluateTimeLogAccess,
} from "./policies";

export interface RequireAuthzOptions {
    action: AuthzAction;
    resource: AuthzResource | AuthzResourceResolver;
}

export interface RequireAuthzHandlerConfig extends RequireAuthzOptions {
    handler: AuthzRouteHandler;
}

type AuthzHandlerWithMetadata = AuthzRouteHandler & {
    authz?: RequireAuthzOptions;
    action?: AuthzAction;
    resource?: AuthzResource | AuthzResourceResolver;
};

type AuthorizationResult = {
    allowed: boolean;
    resourceFound: boolean;
    lookupFailed: boolean;
    /** True when the user has a project membership context (vs an outsider). */
    isMember: boolean;
};

const ACTION_RESOURCE_KIND: Record<AuthzAction, AuthzResourceKind> = {
    "task:view": "task",
    "task:edit": "task",
    "task:delete": "task",
    "project:view": "project",
    "project:edit": "project",
    "project:manage": "project",
    "comment:edit": "comment",
    "timelog:edit": "timelog",
    "planner:edit": "project",
};

function asKnownAction(action: AuthzAction | string): AuthzAction | null {
    return (AUTHZ_ACTIONS as readonly string[]).includes(action)
        ? action as AuthzAction
        : null;
}

function resourceKind(resource: AuthzResource): AuthzResourceKind | null {
    if ("type" in resource) {
        return resource.type;
    }
    if ("kind" in resource) {
        return resource.kind;
    }
    return null;
}

function isValidResource(resource: AuthzResource): boolean {
    const kind = resourceKind(resource);
    return kind !== null && typeof resource.id === "string" && resource.id.length > 0;
}

function normalizeSessionUser(user: unknown): AuthzUser | null {
    if (!user || typeof user !== "object") {
        return null;
    }

    const candidate = user as { id?: unknown; role?: unknown };
    if (typeof candidate.id !== "string" || candidate.id.length === 0) {
        return null;
    }

    return {
        id: candidate.id,
        role: typeof candidate.role === "string" ? candidate.role : null,
    };
}

function logLookupFailure(
    user: AuthzUser,
    action: AuthzAction,
    resource: AuthzResource,
    error: unknown,
): void {
    console.error("[authz] authorization lookup failed", {
        action,
        resourceType: resourceKind(resource),
        resourceId: resource.id,
        userId: user.id,
        error,
    });
}

async function evaluateAuthorization(
    sessionUser: AuthzUser | null | undefined,
    action: AuthzAction | string,
    resource: AuthzResource,
): Promise<AuthorizationResult> {
    const knownAction = asKnownAction(action);
    if (!knownAction || !isValidResource(resource) || !sessionUser?.id) {
        return { allowed: false, resourceFound: true, lookupFailed: false, isMember: true };
    }

    const kind = resourceKind(resource);
    if (!kind || ACTION_RESOURCE_KIND[knownAction] !== kind) {
        return { allowed: false, resourceFound: true, lookupFailed: false, isMember: true };
    }

    try {
        switch (kind) {
            case "task": {
                const context: TaskMembership | null = await loadTaskContext(resource.id, sessionUser.id);
                return context
                    ? { allowed: evaluateTaskAccess(sessionUser, context, knownAction), resourceFound: true, lookupFailed: false, isMember: context.accessLevel !== null }
                    : { allowed: false, resourceFound: false, lookupFailed: false, isMember: false };
            }
            case "project": {
                const context: ProjectMembership | null = await loadProjectContext(resource.id, sessionUser.id);
                return context
                    ? { allowed: evaluateProjectAccess(sessionUser, context, knownAction), resourceFound: true, lookupFailed: false, isMember: context.accessLevel !== null }
                    : { allowed: false, resourceFound: false, lookupFailed: false, isMember: false };
            }
            case "comment": {
                const context: CommentMembership | null = await loadCommentContext(resource.id, sessionUser.id);
                return context
                    ? { allowed: evaluateCommentAccess(sessionUser, context, knownAction), resourceFound: true, lookupFailed: false, isMember: context.accessLevel !== null }
                    : { allowed: false, resourceFound: false, lookupFailed: false, isMember: false };
            }
            case "timelog": {
                const context: TimeLogMembership | null = await loadTimeLogContext(resource.id, sessionUser.id);
                return context
                    ? { allowed: evaluateTimeLogAccess(sessionUser, context, knownAction), resourceFound: true, lookupFailed: false, isMember: context.accessLevel !== null }
                    : { allowed: false, resourceFound: false, lookupFailed: false, isMember: false };
            }
            default:
                return { allowed: false, resourceFound: true, lookupFailed: false, isMember: true };
        }
    } catch (error) {
        logLookupFailure(sessionUser, knownAction, resource, error);
        return { allowed: false, resourceFound: true, lookupFailed: true, isMember: false };
    }
}

/** Authorize a known action against a resource using server-side context. */
export async function authorize(
    sessionUser: AuthzUser | null | undefined,
    action: AuthzAction | string,
    resource: AuthzResource,
): Promise<boolean> {
    const result = await evaluateAuthorization(sessionUser, action, resource);
    return result.allowed;
}

function unauthorized(): Response {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function notFound(): Response {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function forbidden(): Response {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function isOptions(value: unknown): value is RequireAuthzOptions {
    if (!value || typeof value !== "object") {
        return false;
    }

    const candidate = value as { action?: unknown; resource?: unknown };
    return typeof candidate.action === "string" && candidate.resource !== undefined;
}

function routeContext(context: AuthzRouteContext | undefined): AuthzRouteContext {
    return context ?? {};
}

/**
 * Wrap a route handler with session, resource, and policy checks.
 *
 * The object form is the canonical form:
 * requireAuthz({ action, resource, handler }). A function may also carry an
 * `authz` metadata property, or receive the options as its second argument.
 */
export function requireAuthz(
    config: RequireAuthzHandlerConfig,
): (request: Request, context?: AuthzRouteContext) => Promise<Response>;
export function requireAuthz(
    handler: AuthzHandlerWithMetadata,
    options: RequireAuthzOptions,
): (request: Request, context?: AuthzRouteContext) => Promise<Response>;
export function requireAuthz(
    handler: AuthzHandlerWithMetadata,
    action: AuthzAction,
    resource: AuthzResource | AuthzResourceResolver,
): (request: Request, context?: AuthzRouteContext) => Promise<Response>;
export function requireAuthz(
    handler: AuthzHandlerWithMetadata,
): (request: Request, context?: AuthzRouteContext) => Promise<Response>;
export function requireAuthz(
    action: AuthzAction,
    resource: AuthzResource | AuthzResourceResolver,
    handler: AuthzRouteHandler,
): (request: Request, context?: AuthzRouteContext) => Promise<Response>;
export function requireAuthz(
    first: RequireAuthzHandlerConfig | AuthzHandlerWithMetadata | AuthzAction,
    second?: RequireAuthzOptions | AuthzResource | AuthzResourceResolver | AuthzAction,
    third?: AuthzRouteHandler | AuthzResource | AuthzResourceResolver,
): (request: Request, context?: AuthzRouteContext) => Promise<Response> {
    let handler: AuthzRouteHandler | null = null;
    let options: RequireAuthzOptions | null = null;

    if (typeof first === "function") {
        handler = first;
        if (typeof second === "string" && third !== undefined && !isOptions(second)) {
            options = { action: second, resource: third as AuthzResource | AuthzResourceResolver };
        } else if (isOptions(second)) {
            options = second;
        } else if (first.authz) {
            options = first.authz;
        } else if (first.action && first.resource) {
            options = { action: first.action, resource: first.resource };
        }
    } else if (typeof first === "string" && second !== undefined && typeof third === "function") {
        options = { action: first, resource: second as AuthzResource | AuthzResourceResolver };
        handler = third as AuthzRouteHandler;
    } else if (first && typeof first === "object" && "handler" in first) {
        handler = first.handler;
        options = { action: first.action, resource: first.resource };
    }

    return async (request: Request, context?: AuthzRouteContext): Promise<Response> => {
        let session: { user?: unknown } | null = null;
        try {
            session = await auth();
        } catch (error) {
            console.error("[authz] session lookup failed", error);
            return unauthorized();
        }

        const sessionUser = normalizeSessionUser(session?.user);
        if (!sessionUser) {
            return unauthorized();
        }

        if (!handler || !options) {
            return forbidden();
        }

        let resource: AuthzResource | null;
        try {
            resource = typeof options.resource === "function"
                ? await options.resource(request, routeContext(context))
                : options.resource;
        } catch (error) {
            console.error("[authz] resource lookup failed", error);
            return forbidden();
        }

        if (!resource) {
            return notFound();
        }

        const result = await evaluateAuthorization(sessionUser, options.action, resource);
        if (!result.resourceFound && !result.lookupFailed) {
            return notFound();
        }
        if (result.lookupFailed) {
            // Fail closed without leaking whether the resource exists.
            return notFound();
        }
        if (!result.allowed) {
            // Outsiders must be indistinguishable from a missing resource
            // (404); authenticated members with insufficient access get a
            // meaningful 403.
            return result.isMember ? forbidden() : notFound();
        }

        return handler(request, routeContext(context), sessionUser, resource);
    };
}
