import { z } from "zod";
import { defineCapability, type SabahActor } from "../contracts";
import { createSavedView, getSavedViewForActor, listSavedViewsForActor, updateSavedView, voteSavedView } from "@/lib/saved-views/commands";
import { canUpdateSavedView } from "@/lib/saved-views/authorization";
import { createSavedViewSchema, savedViewSearchSchema, updateSavedViewSchema } from "@/lib/saved-views/schemas";

const output = z.object({ id: z.string() }).passthrough();
const ref = z.object({ id: z.string().min(1) });
const writeActor = (actor: SabahActor) => actor.role !== "VIEWER";
const fields = (input: Record<string, unknown>, current?: Record<string, unknown>) => Object.entries(input).filter(([key, value]) => key !== "expectedUpdatedAt" && value !== undefined).map(([path, proposed]) => ({ path, current: current?.[path], proposed }));

export const savedViewsSearchCapability = defineCapability({ name: "savedViews.search", version: 1, module: "savedViews", description: "Search team and personal saved views visible to the actor.", risk: "READ", inputSchema: savedViewSearchSchema, outputSchema: z.array(output), async available() { return true; }, async authorize() {}, async preview(input) { return { title: "Search saved views", fields: [{ path: "query", proposed: input.query || "(all)" }] }; }, async execute(input, context) { return listSavedViewsForActor(input, context.actor) as any; }, async verify(output) { return output; }, summarize(output) { return `Found ${output.length} saved views.`; } });
export const savedViewsCreateCapability = defineCapability({ name: "savedViews.create", version: 1, module: "savedViews", description: "Create a personal or team saved view with validated blocks.", risk: "SENSITIVE_WRITE", requiresExplicitApproval: true, inputSchema: createSavedViewSchema, outputSchema: output, async available(actor) { return writeActor(actor); }, async authorize(_i, c) { if (!writeActor(c.actor)) throw Object.assign(new Error("Forbidden"), { status: 403, code: "FORBIDDEN" }); }, async preview(input) { return { title: `Create saved view “${input.name}”`, fields: fields(input as any) }; }, async execute(input, context) { return createSavedView(input, context.actor) as any; }, async verify(output, context) { return getSavedViewForActor(output.id, context.actor) as any; }, summarize(output) { return `Created saved view “${output.name ?? output.id}”.`; } });
export const savedViewsUpdateCapability = defineCapability({
  name: "savedViews.update", version: 1, module: "savedViews", description: "Update an owned saved view with optimistic concurrency.",
  risk: "SENSITIVE_WRITE", requiresExplicitApproval: true, inputSchema: ref.and(updateSavedViewSchema), outputSchema: output,
  async available(actor) { return writeActor(actor); },
  async authorize(input, context) {
    const current = await getSavedViewForActor(input.id, context.actor);
    if (!canUpdateSavedView(current, context.actor)) throw Object.assign(new Error("Only the owner can update a saved view"), { status: 403, code: "FORBIDDEN" });
  },
  async preview(input, context) {
    const current = await getSavedViewForActor(input.id, context.actor);
    if (!canUpdateSavedView(current, context.actor)) throw Object.assign(new Error("Only the owner can update a saved view"), { status: 403, code: "FORBIDDEN" });
    return { title: `Update saved view “${current.name ?? input.id}”`, fields: fields(input as any, current as any) };
  },
  async execute(input, context) { const { id, ...rest } = input; return updateSavedView(id, rest as any, context.actor) as any; },
  async verify(output, context) { return getSavedViewForActor(output.id, context.actor) as any; },
  summarize(output) { return `Updated saved view “${output.name ?? output.id}”.`; }
});
export const savedViewsVoteCapability = defineCapability({ name: "savedViews.vote", version: 1, module: "savedViews", description: "Toggle the actor's vote for a team or personal saved view.", risk: "REVERSIBLE_WRITE", inputSchema: ref, outputSchema: z.object({ viewId: z.string(), voted: z.boolean() }), async available() { return true; }, async authorize(input, context) { await getSavedViewForActor(input.id, context.actor); }, async preview(input, context) { await getSavedViewForActor(input.id, context.actor); return { title: "Vote for saved view", fields: [{ path: "id", proposed: input.id }] }; }, async execute(input, context) { return voteSavedView(input.id, context.actor); }, async verify(output) { return output; }, summarize(output) { return output.voted ? "Saved view vote recorded." : "Saved view vote removed."; } });
export function registerSavedViewCapabilities(registry: { register: (definition: any) => void }) { [savedViewsSearchCapability, savedViewsCreateCapability, savedViewsUpdateCapability, savedViewsVoteCapability].forEach((capability) => registry.register(capability)); }
