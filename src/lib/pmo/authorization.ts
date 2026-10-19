export type PmoRole = "ADMIN" | "MANAGER" | "MEMBER" | "VIEWER";
export type PmoActor = { id: string; role: PmoRole };
export type PmoAuthorizationContext = {
    ownerId: string;
    parentOwnerId: string | null;
    ownerManagerId: string | null;
};

export class PmoForbiddenError extends Error {
    constructor(message = "Forbidden") {
        super(message);
        this.name = "PmoForbiddenError";
    }
}

export function canManageWorkAreas(actor: PmoActor): boolean {
    return actor.role === "ADMIN" || actor.role === "MANAGER";
}

// Broad PMO reads (all owners / arbitrary owner) and the CSV export expose
// external-party PII in bulk, so they are limited to managers and admins.
// Everyone else is scoped to their own actions.
export function canViewAllPmo(actor: PmoActor): boolean {
    return actor.role === "ADMIN" || actor.role === "MANAGER";
}

export function canSeeAction(actor: PmoActor, ownerId: string): boolean {
    return canViewAllPmo(actor) || ownerId === actor.id;
}

export function canCreatePmoAction(actor: PmoActor): boolean {
    return actor.role !== "VIEWER";
}

export type PmoParentContext = { ownerId: string | null; memberIds: string[] };

export function canAttachToParent(actor: PmoActor, parent: PmoParentContext): boolean {
    return actor.role === "ADMIN" || parent.ownerId === actor.id || parent.memberIds.includes(actor.id);
}

export function assertCanAttachToParent(actor: PmoActor, parent: PmoParentContext): void {
    if (!canAttachToParent(actor, parent)) {
        throw new PmoForbiddenError();
    }
}

export function canManageExternalAction(
    actor: PmoActor,
    context: PmoAuthorizationContext,
): boolean {
    return (
        actor.role === "ADMIN" ||
        actor.id === context.ownerId ||
        actor.id === context.parentOwnerId ||
        actor.id === context.ownerManagerId
    );
}

export function assertCanManageExternalAction(
    actor: PmoActor,
    context: PmoAuthorizationContext,
): void {
    if (!canManageExternalAction(actor, context)) {
        throw new PmoForbiddenError();
    }
}
