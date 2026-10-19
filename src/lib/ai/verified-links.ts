import { isInternalWorkflowHref, workflowEntityLinkSchema } from "@/lib/sabah/workflows/schemas";

/**
 * Verified internal-link evidence for assistant Markdown.
 *
 * An internal entity link (e.g. `/tasks/<id>`) may only be presented as
 * navigation when the exact href was produced by a *successful* server tool
 * result for this conversation. Sources already wired end to end:
 *  - live stream: `tool_result` SSE events with `result.ok === true`
 *  - reload: persisted `toolCalls` entries (server-written `toolCallsJson`)
 * Failed or forged tool results grant no navigation authority, and hrefs are
 * matched exactly — no guessing, normalization, or client-side DB fetches.
 */

/** Upper bound on retained verified hrefs per conversation. */
export const MAX_VERIFIED_HREFS = 512;

const TASK_PROJECTIONS = new Set(["listMyTasks", "searchTasks", "getTask", "createTask", "whatShouldIWorkOnNext"]);
const SAFE_ENTITY_ID = /^[A-Za-z0-9_-]{1,128}$/;
const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const bounded = (value: unknown): unknown[] => Array.isArray(value) ? value.slice(0, MAX_VERIFIED_HREFS) : [];

/** Read only explicit server projections from known tools. Successful uploads
 *  still contain untrusted rows: never recursively mine tool data for links. */
export function collectVerifiedInternalHrefs(results: unknown): string[] {
    const out = new Set<string>();
    const add = (href: unknown) => {
        if (out.size < MAX_VERIFIED_HREFS && isInternalWorkflowHref(href)) out.add(href);
    };
    for (const entry of bounded(Array.isArray(results) ? results : [results])) {
        const call = record(entry);
        const result = record(call?.result);
        if (!call || typeof call.name !== "string" || result?.ok !== true) continue;
        const data = result.data;
        const object = record(data);
        // Only the chat server's bounded omission projector emits this field
        // for these fixed-shape tools. Never accept uploaded-row attestations.
        if (object?.omitted === true && (TASK_PROJECTIONS.has(call.name) || call.name === "proposeWorkflow" || call.name === "workspaceSearch")) {
            for (const href of bounded(object.verifiedLinks)) add(href);
            continue;
        }
        if (TASK_PROJECTIONS.has(call.name)) {
            const rows = Array.isArray(data) ? bounded(data) : Array.isArray(object?.items) ? bounded(object.items) : [data];
            for (const row of rows) {
                const task = record(row);
                if (typeof task?.id === "string" && SAFE_ENTITY_ID.test(task.id) && task.url === `/tasks/${task.id}`) add(task.url);
            }
        } else if (call.name === "proposeWorkflow") {
            for (const step of bounded(object?.steps)) {
                for (const link of bounded(record(step)?.entityLinks)) {
                    const parsed = workflowEntityLinkSchema.safeParse(link);
                    if (parsed.success) add(parsed.data.href);
                }
            }
        } else if (call.name === "workspaceSearch") {
            for (const item of bounded(object?.items)) {
                const source = record(record(item)?.source);
                if (!source) continue;
                const parsed = workflowEntityLinkSchema.safeParse({ type: source.entityType, id: source.entityId, href: source.href, label: source.label });
                if (parsed.success) add(parsed.data.href);
            }
        }
    }
    return Array.from(out);
}

/** Preserve verified navigation when verbose tool data must be omitted from
 *  SSE/persistence. The byte budget covers the complete omission object. */
export function verifiedToolResultOmission(name: string, result: unknown, maxBytes: number = 4096) {
    const omitted = { omitted: true, summary: "Tool completed; result omitted because it exceeded the display limit.", verifiedLinks: [] as string[] };
    for (const href of collectVerifiedInternalHrefs({ name, result })) {
        omitted.verifiedLinks.push(href);
        if (new TextEncoder().encode(JSON.stringify(omitted)).length > maxBytes) {
            omitted.verifiedLinks.pop();
            break;
        }
    }
    return omitted;
}

/** Merge hrefs into a bounded insertion-ordered set (oldest dropped first). */
export function appendVerifiedHrefs(current: ReadonlySet<string>, hrefs: readonly string[], cap: number = MAX_VERIFIED_HREFS): Set<string> {
    const merged = new Set(current);
    for (const href of hrefs) {
        if (merged.has(href)) continue;
        merged.add(href);
        while (merged.size > cap) {
            const oldest = merged.values().next().value;
            if (oldest === undefined) break;
            merged.delete(oldest);
        }
    }
    return merged;
}
