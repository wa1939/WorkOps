import { z } from "zod";
import { defineCapability } from "../contracts";
import type { CapabilityRegistry } from "../registry";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import { assertSupportRequestVisible, claimSupportRequest, createSupportRequest, listSupportForActor } from "@/lib/support/commands";
import { createSupportRequestSchema, supportRequestIdSchema } from "@/lib/support/schemas";

const writeActor = (actor: SabahActor) => actor.role !== "VIEWER";
const supportRef = z.object({ id: supportRequestIdSchema });
const searchInput = z.object({ query: z.string().trim().max(200).default(""), projectId: supportRequestIdSchema.optional(), taskId: supportRequestIdSchema.optional(), status: z.string().optional(), limit: z.number().int().positive().max(100).optional() });
const claimInput = supportRef;

export const supportSearchCapability = defineCapability({
  name: "support.search", version: 1, module: "support", description: "Search support requests visible to the actor.", risk: "READ", inputSchema: searchInput, outputSchema: z.array(z.object({ id: z.string() }).passthrough()),
  async available() { return true; }, async authorize() {},
  async preview(input) { return { title: `Search support requests${input.query ? ` matching “${input.query}”` : ""}`, fields: [{ path: "query", proposed: input.query || "(all)" }] }; },
  async execute(input, context) { return listSupportForActor({ ...input, query: input.query || undefined }, context.actor); },
  async verify(output) { return output; }, summarize(output) { return `Found ${output.length} support request${output.length === 1 ? "" : "s"}.`; },
});

export const supportCreateCapability = defineCapability({
  name: "support.create", version: 1, module: "support", description: "Create a support request linked to a visible active project or task.", risk: "REVERSIBLE_WRITE", inputSchema: createSupportRequestSchema, outputSchema: z.object({ id: z.string() }).passthrough(),
  async available(actor) { return writeActor(actor); }, async authorize() {},
  async preview(input) { return { title: `Create support request “${input.title}”`, fields: [
    { path: "title", proposed: input.title }, { path: "description", proposed: input.description || "(none)" },
    { path: "projectId", proposed: input.projectId ? "Linked project" : "(none)" }, { path: "taskId", proposed: input.taskId ? "Linked task" : "(none)" },
    { path: "notificationAudience", proposed: "Project members who can view all linked entities and task assignees (deduplicated; requester excluded)" },
  ] }; },
  async execute(input, context) { return createSupportRequest(input, context.actor); }, async verify(output) { return output; },
  async compensate() { throw new Error("Support request deletion is not supported."); }, summarize(output) { return `Created support request “${output.title ?? output.id}”.`; },
});

export const supportClaimCapability = defineCapability({
  name: "support.claim", version: 1, module: "support", description: "Atomically claim a visible open support request.", risk: "REVERSIBLE_WRITE", inputSchema: claimInput, outputSchema: z.object({ id: z.string() }).passthrough(),
  async available(actor) { return writeActor(actor); }, async authorize(i, c) { if (!writeActor(c.actor)) throw Object.assign(new Error("Forbidden"), { status: 403, code: "FORBIDDEN" }); await assertSupportRequestVisible(i.id, c.actor); },
  async preview(input, c) { if (!writeActor(c.actor)) throw Object.assign(new Error("Forbidden"), { status: 403, code: "FORBIDDEN" }); const current = await assertSupportRequestVisible(input.id, c.actor); if (current.claimedById || current.status !== "Open") throw Object.assign(new Error("Support request already claimed"), { status: 409, code: "ALREADY_CLAIMED" }); return { title: "Claim support request", fields: [{ path: "id", proposed: input.id }, { path: "status", current: current.status, proposed: "Claimed" }, { path: "claimedBy", proposed: "Current actor" }] }; },
  async execute(input, context) { return claimSupportRequest(input.id, context.actor); }, async verify(output) { return output; },
  async compensate() { throw new Error("Support claim release is not supported."); }, summarize(output) { return `Claimed support request ${output.id}.`; },
});

export const SUPPORT_CAPABILITIES = [supportSearchCapability, supportCreateCapability, supportClaimCapability] as const;
export function registerSupportCapabilities(registry: Pick<CapabilityRegistry, "register">): void { for (const capability of SUPPORT_CAPABILITIES) registry.register(capability as any); }
