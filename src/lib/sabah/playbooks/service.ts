import type { PlaybookActor, PlaybookAdapter, PlaybookDraftInput, PlaybookRecord, PlaybookServiceOptions } from "./contracts";
import { isValidPlaybookRecord, playbookChecksum, playbookContentChecksum } from "./contracts";
export type { PlaybookAdapter } from "./contracts";
import { BUILTIN_PLAYBOOKS } from "./builtins";
import { canApproveMemory, canAccessMemory } from "@/lib/sabah/memory/authorization";

const MAX = { id: 80, text: 128, items: 16, context: 64, schemaKeys: 32, evaluations: 16 } as const;
export class PlaybookServiceError extends Error { constructor(message: string, readonly code: string) { super(message); this.name = "PlaybookServiceError"; } }
const reject = (message: string, code: string): never => { throw new PlaybookServiceError(message, code); };
const approvalLevel = (actor: PlaybookActor): boolean => actor.role === "ADMIN" || actor.role === "LEAD";
export const deepFreeze = <T>(value: T): T => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); } return value; };
const copy = <T>(value: T): T => structuredClone(value);
const boundedString = (value: unknown, limit: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= limit;
const boundedList = (values: unknown, limit: number, itemLimit: number): values is readonly string[] => Array.isArray(values) && values.length > 0 && values.length <= limit && values.every((value) => boundedString(value, itemLimit));
const globalApprovals = (options: PlaybookServiceOptions): readonly string[] => {
  const configured = options.globalRequiredApprovals;
  if (configured === undefined) return ["lead"];
  if (!Array.isArray(configured) || configured.length === 0 || configured.length > MAX.items || !configured.every((approval) => boundedString(approval, MAX.id))) reject("Invalid global approval policy", "INVALID_POLICY");
  return configured;
};
const boundedSchema = (value: unknown, depth = 0): boolean => { if (depth > 4 || !value || typeof value !== "object" || Array.isArray(value)) return false; const entries = Object.entries(value); return entries.length <= MAX.schemaKeys && entries.every(([key, child]) => key.length <= MAX.id && (typeof child === "string" ? child.length <= MAX.text : typeof child === "number" ? Number.isFinite(child) : typeof child === "boolean" || (child !== null && boundedSchema(child, depth + 1)))); };
export function validatePlaybookDraft(input: PlaybookDraftInput, actor: PlaybookActor, options: PlaybookServiceOptions): void {
  const triggers = input.triggers && typeof input.triggers === "object" ? input.triggers : undefined;
  if (!boundedString(input.playbookId, MAX.id) || !Number.isInteger(input.version) || input.version < 1 || !boundedString(input.name, MAX.text) || !boundedString(input.description, MAX.text) || !triggers || !boundedList(triggers.en, MAX.items, MAX.text) || !boundedList(triggers.ar, MAX.items, MAX.text) || !boundedList(input.requiredContext, MAX.items, MAX.context) || !boundedList(input.allowedCapabilities, MAX.items, MAX.id) || !Array.isArray(input.requiredApprovals) || input.requiredApprovals.length > MAX.items || !input.requiredApprovals.every((value) => boundedString(value, MAX.id)) || (input.approvalOverrides !== undefined && !boundedList(input.approvalOverrides, MAX.items, MAX.id)) || !boundedSchema(input.outputSchema) || !Array.isArray(input.evaluationCases) || input.evaluationCases.length === 0 || input.evaluationCases.length > MAX.evaluations || !input.evaluationCases.every((item) => !!item && boundedString(item.input, MAX.text) && boundedString(item.expected, MAX.text))) reject("Invalid playbook draft", "INVALID_INPUT");
  if (input.scope === "USER" && input.ownerId !== actor.id) reject("Playbook owner is outside actor scope", "SCOPE_FORBIDDEN");
  if (input.scope === "DEPARTMENT" && (!input.departmentId || !actor.departmentIds.includes(input.departmentId))) reject("Playbook department is outside actor scope", "SCOPE_FORBIDDEN");
  if ((input.scope === "TEAM" || input.scope === "WORKSPACE") && !boundedString(input.ownerId, MAX.id)) reject("Shared playbook requires an owner", "SCOPE_FORBIDDEN");
  const global = globalApprovals(options);
  if (!global.every((approval) => input.requiredApprovals.includes(approval)) || !input.requiredApprovals.some((approval) => approval === "lead" || approval === "admin")) reject("Playbook requires the global approval policy", "APPROVAL_POLICY");
  for (const name of input.allowedCapabilities) { try { const capability = options.registry.resolve(name, 1); if (capability.name !== name || capability.risk === "BLOCKED") reject(`Capability ${name} is not allowed`, "CAPABILITY_NOT_ALLOWED"); } catch { reject(`Capability ${name} is not registered`, "CAPABILITY_NOT_ALLOWED"); } }
}
const identity = (row: Pick<PlaybookRecord, "id" | "scope" | "ownerId" | "departmentId">) => ({ id: row.id, scope: row.scope, ownerId: row.ownerId, departmentId: row.departmentId });
async function sharedAllowed(actor: PlaybookActor, row: Pick<PlaybookRecord, "id" | "scope" | "ownerId" | "departmentId">, options: PlaybookServiceOptions, approval: boolean): Promise<boolean> {
  if (row.scope === "USER") return row.ownerId === actor.id;
  if (row.scope === "DEPARTMENT") return !!row.departmentId && actor.departmentIds.includes(row.departmentId);
  const policy = approval ? options.sharedApprovalPolicy : options.sharedAccessPolicy;
  return !!policy && await policy(actor, identity(row));
}
const hasValidChecksum = (row: PlaybookRecord): boolean => typeof row.checksum === "string" && row.checksum === playbookChecksum(row);
async function get(id: string, options: PlaybookServiceOptions): Promise<PlaybookRecord> { const row = await options.adapter.get(id); if (!row) return reject("Playbook not found", "PLAYBOOK_NOT_FOUND"); if (!isValidPlaybookRecord(row)) reject("Invalid playbook record", "INVALID_RECORD"); if (!hasValidChecksum(row)) reject("Playbook content is immutable", "IMMUTABLE_RECORD"); return deepFreeze(copy(row)); }
async function transition(id: string, actor: PlaybookActor, state: PlaybookRecord["state"], options: PlaybookServiceOptions, approval: boolean): Promise<PlaybookRecord> { const row = await get(id, options); if (!(await sharedAllowed(actor, row, options, approval))) reject("Actor cannot access this playbook scope", "SCOPE_FORBIDDEN"); const expectedChecksum = typeof row.checksum === "string" ? row.checksum : reject("Playbook content is immutable", "IMMUTABLE_RECORD"); const expectedContent = playbookContentChecksum(row); return options.adapter.transaction(async () => { const result = await options.adapter.update(id, { state }, { checksum: expectedChecksum, version: row.version, state: row.state }); if (!isValidPlaybookRecord(result)) reject("Invalid playbook record", "INVALID_RECORD"); if (result.id !== row.id || result.playbookId !== row.playbookId || result.version !== row.version || result.state !== state || result.checksum !== expectedChecksum || playbookContentChecksum(result) !== expectedContent) reject("Playbook content is immutable", "IMMUTABLE_RECORD"); return deepFreeze(copy(result)); }); }

export async function createPlaybookDraft(input: PlaybookDraftInput, actor: PlaybookActor, options: PlaybookServiceOptions): Promise<PlaybookRecord> {
  if (BUILTIN_PLAYBOOKS.some((item) => item.playbookId === input.playbookId)) reject("Built-in playbooks are immutable", "BUILTIN_IMMUTABLE");
  validatePlaybookDraft(input, actor, options);
  const identityRow = { id: `draft:${input.playbookId}:${input.version}`, scope: input.scope, ownerId: input.ownerId, departmentId: input.departmentId ?? null };
  if (!(await sharedAllowed(actor, identityRow, options, false))) reject("Actor cannot access this playbook scope", "SCOPE_FORBIDDEN");
  return options.adapter.transaction(async () => { const existing = (await options.adapter.list()).filter((row) => row.playbookId === input.playbookId); const next = existing.length ? Math.max(...existing.map((row) => row.version)) + 1 : 1; if (input.version !== next) reject("Playbook versions must append exactly one version", "VERSION_INVALID"); const expectedChecksum = playbookChecksum(input); const expectedContent = playbookContentChecksum(input); const result = await options.adapter.create({ ...copy(input), state: "DRAFT", builtin: false, checksum: expectedChecksum }); if (!isValidPlaybookRecord(result) || result.id.length === 0 || result.playbookId !== input.playbookId || result.version !== input.version || result.state !== "DRAFT" || result.checksum !== expectedChecksum || playbookContentChecksum(result) !== expectedContent) reject("Invalid playbook record", "INVALID_RECORD"); return deepFreeze(copy(result)); });
}
export async function submitPlaybookReview(id: string, actor: PlaybookActor, options: PlaybookServiceOptions): Promise<PlaybookRecord> { const row = await get(id, options); if (row.state !== "DRAFT") reject("Only drafts can enter review", "INVALID_STATE"); return transition(id, actor, "IN_REVIEW", options, false); }
export async function approvePlaybookVersion(id: string, actor: PlaybookActor, reason: string, options: PlaybookServiceOptions): Promise<PlaybookRecord> { const row = await get(id, options); if (row.state !== "IN_REVIEW") reject("Only in-review playbooks can be approved", "INVALID_STATE"); if (!approvalLevel(actor) || !boundedString(reason, MAX.text)) reject("Approval is not authorized", "APPROVAL_FORBIDDEN"); return transition(id, actor, "APPROVED", options, true); }
export async function archivePlaybook(id: string, actor: PlaybookActor, options: PlaybookServiceOptions): Promise<PlaybookRecord> { const row = await get(id, options); if (row.state !== "APPROVED") reject("Only approved playbooks can be archived", "INVALID_STATE"); if (!approvalLevel(actor)) reject("Archive is not authorized", "APPROVAL_FORBIDDEN"); return transition(id, actor, "ARCHIVED", options, true); }
export function createPlaybookService(options: PlaybookServiceOptions) { return { createPlaybookDraft: (input: PlaybookDraftInput, actor: PlaybookActor) => createPlaybookDraft(input, actor, options), submitPlaybookReview: (id: string, actor: PlaybookActor) => submitPlaybookReview(id, actor, options), approvePlaybookVersion: (id: string, actor: PlaybookActor, reason: string) => approvePlaybookVersion(id, actor, reason, options), archivePlaybook: (id: string, actor: PlaybookActor) => archivePlaybook(id, actor, options) }; }
