import { z } from "zod";
import type { ExecutorContext, ToolResult } from "./executors";
import { resolvePmoActor } from "@/lib/pmo/actor";
import { canSeeAction, type PmoActor } from "@/lib/pmo/authorization";
import { toRiyadhDate } from "@/lib/pmo/date";
import { parsePmoFilters } from "@/lib/pmo/portfolio";
import { loadPmoPortfolio, type PmoActionRow } from "@/lib/pmo/portfolio-query";
import { generatePmoDraft, readPmoActionForActor } from "@/lib/sabah/capabilities/modules/pmo";

// ── Pure helpers (unit-tested) ─────────────────────────────────────────────

/** Map a friendly bucket param to the parser's enum, or undefined. */
export function mapDueBucket(input?: string): "OVERDUE" | "DUE_7" | "DUE_30" | undefined {
    switch ((input ?? "").toLowerCase()) {
        case "overdue":
            return "OVERDUE";
        case "due7":
        case "duesoon":
        case "due_7":
            return "DUE_7";
        case "due30":
        case "due_30":
            return "DUE_30";
        default:
            return undefined;
    }
}

/** Compact projection for chat — drops contact PII (email/dept) and evidence. */
export function compactPmoRow(r: PmoActionRow) {
    return {
        id: r.id,
        title: r.title,
        status: r.status,
        dueDate: r.dueDate,
        dueBucket: r.dueBucket,
        ownerName: r.ownerName,
        contactName: r.contactName,
        contactOrganization: r.contactOrganization,
        workAreaName: r.workAreaName,
        parentName: r.parentName,
        lastFollowUpAt: r.lastFollowUpAt,
        nextReminder: r.nextReminder,
    };
}

/** Visibility: managers see all; everyone else only their own actions. */
export { canSeeAction };

// ── Schemas ────────────────────────────────────────────────────────────────

const listSchema = z
    .object({
        ownerId: z.string().optional(),
        status: z.string().optional(),
        dueBucket: z.string().optional(),
        workArea: z.string().optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(30).optional(),
    })
    .strict();

const taskIdSchema = z.object({ taskId: z.string().min(1) }).strict();

const UNAVAILABLE = "PMO is not available for this account.";
const NOT_FOUND = "Action not found.";

async function resolveActorOrNull(userId: string): Promise<PmoActor | null> {
    try {
        return await resolvePmoActor(userId);
    } catch {
        return null;
    }
}

// ── Executors ────────────────────────────────────────────────────────────────

export async function executeListPmoActions(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = listSchema.parse(rawParams ?? {});
    const actor = await resolveActorOrNull(ctx.userId);
    if (!actor) return { ok: false, error: UNAVAILABLE };

    // loadPmoPortfolio force-scopes non-managers to their own actions.
    const filters = parsePmoFilters({
        ownerId: params.ownerId ?? "all",
        status: params.status,
        dueBucket: mapDueBucket(params.dueBucket),
    });
    const today = toRiyadhDate(new Date());
    const { rows, metrics, options } = await loadPmoPortfolio(filters, actor, today);

    let workAreaNote: string | undefined;
    let filtered = rows;
    if (params.workArea) {
        const wa = params.workArea.toLowerCase();
        const known = options.workAreas.some((w) => w.name.toLowerCase() === wa);
        if (known) filtered = filtered.filter((r) => r.workAreaName.toLowerCase() === wa);
        else workAreaNote = `Unknown work area "${params.workArea}" — showing all`;
    }
    if (params.query) {
        const q = params.query.toLowerCase();
        filtered = filtered.filter((r) => `${r.title} ${r.contactName} ${r.parentName}`.toLowerCase().includes(q));
    }

    const limit = params.limit ?? 20;
    const sliced = filtered.slice(0, limit).map(compactPmoRow);
    return {
        ok: true,
        data: {
            metrics,
            total: filtered.length,
            shown: sliced.length,
            actions: sliced,
            ...(workAreaNote ? { workAreaNote } : {}),
        },
    };
}

export async function executeGetPmoAction(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = taskIdSchema.parse(rawParams);
    const actor = await resolveActorOrNull(ctx.userId);
    if (!actor) return { ok: false, error: UNAVAILABLE };

    let task;
    try {
        task = await readPmoActionForActor(params.taskId, actor);
    } catch {
        return { ok: false, error: NOT_FOUND };
    }
    const action = task.externalAction;
    if (!action) return { ok: false, error: NOT_FOUND };

    return {
        ok: true,
        data: {
            id: task!.id,
            title: task!.title,
            description: task!.description ?? "",
            status: task!.status,
            dueDate: task!.dueAt ? toRiyadhDate(task!.dueAt) : null,
            owner: action.owner.name,
            contact: {
                name: action.externalContact.name,
                email: action.externalContact.email,
                department: action.externalContact.department ?? "",
                organization: action.externalContact.organization ?? "",
            },
            evidence: action.evidence.map((e) => ({ label: e.label, url: e.url })),
            followUps: action.followUpEvents.map((f) => ({
                scheduledDate: f.scheduledDate.toISOString().slice(0, 10),
                sentAt: f.sentAt?.toISOString() ?? null,
            })),
            lastResponseAt: action.lastExternalResponseAt?.toISOString() ?? null,
            closedAt: action.closedAt?.toISOString() ?? null,
            closureNote: action.closureNote ?? "",
        },
    };
}

export async function executeDraftPmoFollowUp(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = taskIdSchema.parse(rawParams);
    const actor = await resolveActorOrNull(ctx.userId);
    if (!actor) return { ok: false, error: UNAVAILABLE };

    let draft;
    try {
        draft = await generatePmoDraft(params.taskId, actor);
    } catch {
        return { ok: false, error: NOT_FOUND };
    }

    return {
        ok: true,
        data: {
            subject: draft.subject,
            body: draft.body,
            recipient: draft.recipient,
            note: "Copy this into your own email client and send it yourself, then mark it sent from the /pmo page — Sabah cannot send emails.",
        },
    };
}
