import type { SabahActor } from "@/lib/sabah/auth/actor";
export class KpiCommandError extends Error { constructor(message: string, public readonly status: number, public readonly code: string) { super(message); this.name = "KpiCommandError"; } }
export function canWriteKpi(actor: SabahActor) { return actor.role !== "VIEWER"; }
export function assertCanReadKpi(actor: SabahActor) {
    if (!actor.id || !["ADMIN", "LEAD", "MEMBER", "VIEWER"].includes(actor.role)) {
        throw new KpiCommandError("Actor cannot read KPIs", 403, "FORBIDDEN");
    }
    // KPIs are department-level records. A non-admin must belong to at least one
    // department; otherwise a read would expose the entire shared KPI catalog.
    if (actor.role !== "ADMIN" && actor.departmentIds.length === 0) {
        throw new KpiCommandError("Actor has no department membership", 403, "FORBIDDEN");
    }
}
export function assertCanWriteKpi(actor: SabahActor) { if (!canWriteKpi(actor)) throw new KpiCommandError("VIEWER cannot mutate KPIs", 403, "FORBIDDEN"); }
export function assertDepartmentKpi(input: { ownerId?: string | null }) { if (input.ownerId !== undefined && input.ownerId !== null) throw new KpiCommandError("KPIs are department-level and cannot have an owner", 400, "INVALID_REFERENCE"); }
