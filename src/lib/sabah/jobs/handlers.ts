import { z } from "zod";
import type { JobType, JsonValue } from "./contracts";
import { executeNextStep, type SabahActor, type WorkflowDatabase } from "../workflows/service";
import { compressConversation, type CompressionDb } from "../continuity/compression";
import { indexEntity, parseSourceRef, type IndexDb } from "../intelligence/indexer";
import { parseIntakeBuffer, INTAKE_MAX_BYTES, type ParsedIntake } from "@/lib/ai/intake-parse";
import { prisma } from "@/lib/prisma";
import { getRunnerDeps } from "../capabilities/runner-deps";
import { toSabahActor } from "../auth/actor";

export type JobHandlerContext = { jobId: string; actorId: string | null; workflowId: string | null; stepId: string | null; signal: AbortSignal; checkpoint: JsonValue | undefined; heartbeat: () => Promise<void>; saveCheckpoint: (value: JsonValue) => Promise<void> };
export type JobHandler = (payload: unknown, context: JobHandlerContext) => Promise<{ result: unknown }>;
export type JobHandlerRegistry = { get(type: JobType): JobHandler; set(type: JobType, handler: JobHandler): void };
const MAX_TYPES = 4;
export const EXTRACTION_STORAGE_LIMITATION = "EXTRACTION_STORAGE_UNAVAILABLE";
const boundedObject = z.record(z.string().max(80), z.unknown()).refine((x) => JSON.stringify(x).length <= 48_000, "payload exceeds bounds");
function payloadObject(payload: unknown): Record<string, unknown> { const parsed = boundedObject.safeParse(payload); if (!parsed.success) throw permanent("malformed job payload"); return parsed.data; }
function permanent(message: string): Error { const error = new Error(message); error.name = "PermanentJobError"; return error; }
function active(context: JobHandlerContext): void { context.signal.throwIfAborted(); }
function actor(id: string | null, value: unknown): SabahActor { const p = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}; const role = p.role; if (!id || !["ADMIN", "LEAD", "MEMBER", "VIEWER"].includes(String(role))) throw permanent("actor context required"); return { id, role: role as SabahActor["role"], departmentIds: Array.isArray(p.departmentIds) ? p.departmentIds.filter((x): x is string => typeof x === "string").slice(0, 100) : [] }; }
export function createJobHandlerRegistry(initial: Partial<Record<JobType, JobHandler>> = {}): JobHandlerRegistry { const handlers = new Map<JobType, JobHandler>(); for (const [type, handler] of Object.entries(initial)) if (handler) handlers.set(type as JobType, handler); return { get(type) { const handler = handlers.get(type); if (!handler) throw permanent(`unknown job type: ${type}`); return handler; }, set(type, handler) { if (handlers.size >= MAX_TYPES && !handlers.has(type)) throw new Error("handler registry bound exceeded"); handlers.set(type, handler); } }; }
export function registerJobHandler(type: JobType, handler: JobHandler, registry: JobHandlerRegistry): JobHandlerRegistry { registry.set(type, handler); return registry; }
export type AssetReader = (assetId: string, context: JobHandlerContext) => Promise<{ filename: string; buffer: Buffer }>;
export type DefaultHandlerDeps = { workflowDb?: WorkflowDatabase; runnerDeps?: Parameters<typeof executeNextStep>[3]; compressionDb?: CompressionDb; indexDb?: IndexDb; actor?: (id: string) => Promise<SabahActor>; assetReader?: AssetReader };
function validActorDescriptor(value: unknown): value is { role: SabahActor["role"]; departmentIds: string[] } { return typeof value === "object" && value !== null && ["ADMIN", "LEAD", "MEMBER", "VIEWER"].includes(String((value as Record<string, unknown>).role)); }
export function createDefaultJobHandlerRegistry(deps: DefaultHandlerDeps = {}): JobHandlerRegistry {
  const registry = createJobHandlerRegistry();
  const resolveActor = async (id: string | null, value: unknown): Promise<SabahActor> => { if (deps.actor && id) return deps.actor(id); if (id && validActorDescriptor(value)) return actor(id, value); if (id) { const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, departments: { select: { departmentId: true } } } }); if (user && ["ADMIN", "LEAD", "MEMBER", "VIEWER"].includes(user.role)) return { id: user.id, role: user.role as SabahActor["role"], departmentIds: user.departments.map((d) => d.departmentId).slice(0, 100) }; } throw permanent("actor context required"); };
  registerJobHandler("WORKFLOW_STEP", async (payload, context) => { active(context); const p = payloadObject(payload); if (!deps.workflowDb || !deps.runnerDeps || !context.workflowId || !context.stepId) throw permanent("workflow handler unavailable"); const result = await executeNextStep(await resolveActor(context.actorId, p.actor), context.workflowId, deps.workflowDb, deps.runnerDeps, { requestedStepId: context.stepId, mode: "inline", signal: context.signal }); active(context); return { result }; }, registry);
  registerJobHandler("COMPRESSION", async (payload, context) => { active(context); const p = payloadObject(payload); if (!deps.compressionDb || typeof p.conversationId !== "string" || p.conversationId.length > 200) throw permanent("compression payload invalid"); const result = await compressConversation(p.conversationId, await resolveActor(context.actorId, p.actor), deps.compressionDb, { signal: context.signal }); active(context); return { result }; }, registry);
  registerJobHandler("INDEX_ENTITY", async (payload, context) => { active(context); if (!deps.indexDb) throw permanent("index handler unavailable"); const p = payloadObject(payload); const ref = parseSourceRef(p); if (!ref) throw permanent("index payload invalid"); const result = await indexEntity(ref, deps.indexDb, { signal: context.signal }); active(context); return { result }; }, registry);
  registerJobHandler("EXTRACTION", async (payload, context) => { const p = payloadObject(payload); if (typeof p.assetId !== "string" || p.assetId.length < 1 || p.assetId.length > 200 || !deps.assetReader) throw permanent(!deps.assetReader ? EXTRACTION_STORAGE_LIMITATION : "extraction payload invalid"); const asset = await deps.assetReader(p.assetId, context); if (!asset || typeof asset.filename !== "string" || asset.filename.length < 1 || asset.filename.length > 200 || !Buffer.isBuffer(asset.buffer) || asset.buffer.length > INTAKE_MAX_BYTES) throw permanent("extraction asset invalid"); const parsed: ParsedIntake = await parseIntakeBuffer(asset.filename, asset.buffer); return { result: parsed }; }, registry);
  return registry;
}
export const defaultJobHandlerRegistry = createDefaultJobHandlerRegistry({ workflowDb: prisma as unknown as WorkflowDatabase, runnerDeps: getRunnerDeps(), compressionDb: prisma as unknown as CompressionDb, indexDb: prisma as unknown as IndexDb, actor: (id) => toSabahActor({ id }) });
