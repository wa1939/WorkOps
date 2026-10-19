import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SabahForbiddenError, toSabahActor } from "@/lib/sabah/auth/actor";
import { encryptConnectorCredential } from "@/lib/sabah/connectors/crypto";
import { isValidConnectorKey } from "@/lib/sabah/connectors/registry";
import { SABAH_LIFECYCLE_EVENT_NAMES } from "@/lib/sabah/events/contracts";
import { getConnectorRuntime } from "./connector-runtime";

const directions = ["INBOUND", "OUTBOUND", "BIDIRECTIONAL"] as const;
const eventSchema = z.enum(SABAH_LIFECYCLE_EVENT_NAMES);
const configSchema = z.record(z.string().max(64), z.union([z.string().max(512), z.number().finite(), z.boolean(), z.null()])).refine((value) => Object.keys(value).length <= 32, "Too many configuration fields").refine((value) => !Object.keys(value).some((key) => /(url|endpoint|uri|password|token|secret|credential|authorization|api[-_]?key)/i.test(key)), "URLs and secrets are not accepted");
const connectorInput = z.object({
  key: z.string().min(1).max(64).refine(isValidConnectorKey, "Invalid connector key"),
  version: z.number().int().min(0).max(1000),
  kind: z.string().min(1).max(128),
  direction: z.enum(directions),
  eventType: eventSchema,
  capability: z.string().min(1).max(255).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/),
  dataPolicy: z.string().min(1).max(2000),
  config: configSchema.default({}),
  credential: z.string().max(16_384).optional(),
  enabled: z.boolean().optional(),
}).strict();
const idSchema = z.string().regex(/^[A-Za-z0-9:_./-]{1,160}$/);

type AdminSession = { user?: { id?: string | null; role?: string | null } } | null;
// Connector administration must authorize from the persisted role and active
// flag, not the session JWT, so demotions and deactivations apply immediately.
async function adminOnly(session: AdminSession): Promise<NextResponse | null> {
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const actor = await toSabahActor(session.user);
    if (actor.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  } catch (error) {
    if (error instanceof SabahForbiddenError) return NextResponse.json({ error: "Admin only" }, { status: 403 });
    throw error;
  }
  return null;
}
function safeConnector(row: { id: string; key: string; version: number; kind: string; direction: string; enabled: boolean; eventType: string; capability: string; dataPolicy: string; configJson: string | null; credential?: unknown; updatedAt: Date; createdAt: Date }) {
  return { id: row.id, key: row.key, version: row.version, kind: row.kind, direction: row.direction, enabled: row.enabled, eventType: row.eventType, capability: row.capability, dataPolicy: row.dataPolicy, config: {}, credential: row.credential ? "configured" : "not_configured", createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function unavailable(): NextResponse { return NextResponse.json({ ok: false, code: "unavailable" }, { status: 503 }); }
async function localConnectorTestTransport(input: { connectorId: string; eventType: string; config: unknown }): Promise<{ code: "delivered" | "unavailable" | "failed" }> {
  const portText = process.env.SABAH_PLAN10_CONTROL_PORT ?? "4010";
  if (!/^\d{1,5}$/.test(portText)) throw new Error("Invalid local control port");
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid local control port");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/connector/test`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ connectorId: input.connectorId, eventType: input.eventType }), signal: controller.signal });
    const text = await response.text();
    if (!response.ok || text.length > 8_192) throw new Error("Local connector control failed");
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error("Local connector control returned malformed JSON"); }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Local connector control returned invalid result");
    const code = Object.fromEntries(Object.entries(parsed)).code;
    if (code !== "delivered" && code !== "unavailable" && code !== "failed") throw new Error("Local connector control returned invalid code");
    return { code };
  } finally { clearTimeout(timer); }
}
async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  if (text.length > 64 * 1024) throw new Error("invalid_body");
  try { return JSON.parse(text) as unknown; } catch { throw new Error("invalid_body"); }
}

export async function GET(request: Request): Promise<NextResponse> {
  const denied = await adminOnly(await auth());
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  try {
    if (id && !idSchema.safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const rows = id
      ? await prisma.aiConnector.findMany({ where: { id }, include: { credential: { select: { id: true } } }, take: 1 })
      : await prisma.aiConnector.findMany({ orderBy: [{ key: "asc" }, { version: "asc" }], include: { credential: { select: { id: true } } } });
    return NextResponse.json({ connectors: rows.map(safeConnector) });
  } catch { return unavailable(); }
}

async function handleConnectorPost(request: Request, override?: Record<string, unknown>): Promise<NextResponse> {
  const denied = await adminOnly(await auth());
  if (denied) return denied;
  try {
    const runtime = getConnectorRuntime();
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid connector request" }, { status: 400 });
    const record = { ...(body as Record<string, unknown>), ...override };
    const action = record.action;
    if (action === "test") {
      const id = idSchema.parse(record.id);
      const testTransport = runtime.testTransport ?? (process.env.SABAH_PLAN10_LOCAL_RUNTIME === "1" ? localConnectorTestTransport : undefined);
      if (!testTransport) return unavailable();
      const row = await prisma.aiConnector.findUnique({ where: { id }, select: { id: true, eventType: true, configJson: true, enabled: true } });
      if (!row || !row.enabled) return unavailable();
      const result = await testTransport({ connectorId: row.id, eventType: row.eventType, config: {} });
      return result.code === "delivered" ? NextResponse.json({ ok: true, code: result.code }) : unavailable();
    }
    if (action === "enable" || action === "disable") {
      const id = idSchema.parse(record.id);
      const row = await prisma.aiConnector.update({ where: { id }, data: { enabled: action === "enable" } });
      return NextResponse.json({ connector: safeConnector({ ...row, credential: null }) });
    }
    const input = connectorInput.parse(record);
    if (!runtime.resolveConnector) return unavailable();
    const definition = await runtime.resolveConnector(input.key, input.version);
    if (!definition || definition.key !== input.key || definition.storedVersion !== input.version || !definition.enabled || !definition.supportedEvents.includes(input.eventType) || !definition.supportedCapabilities.includes(input.capability) || typeof definition.kind !== "string" || typeof definition.dataPolicy !== "string") return unavailable();
    const configResult = definition.configSchema.safeParse(input.config);
    if (!configResult.success) return NextResponse.json({ error: "Invalid connector configuration" }, { status: 400 });
    if (input.credential !== undefined) {
      const credentialKey = runtime.masterKey ?? process.env.SABAH_CREDENTIAL_KEY;
      if (!credentialKey) return unavailable();
      const credentials = definition.credentialSchema.safeParse(input.credential);
      if (!credentials.success) return NextResponse.json({ error: "Invalid connector credential" }, { status: 400 });
    }
    const row = await prisma.aiConnector.upsert({
      where: { key_version: { key: input.key, version: input.version } },
      update: { kind: definition.kind, direction: definition.direction, eventType: input.eventType, capability: input.capability, dataPolicy: definition.dataPolicy, configJson: JSON.stringify(configResult.data), ...(input.enabled === undefined ? {} : { enabled: input.enabled }) },
      create: { key: input.key, version: input.version, kind: definition.kind, direction: definition.direction, eventType: input.eventType, capability: input.capability, dataPolicy: definition.dataPolicy, configJson: JSON.stringify(configResult.data), enabled: input.enabled ?? false },
    });
    if (input.credential !== undefined) {
      const credentialKey = runtime.masterKey ?? process.env.SABAH_CREDENTIAL_KEY;
      if (!credentialKey) return unavailable();
      const encrypted = encryptConnectorCredential(input.credential, credentialKey, { connectorKey: input.key });
      const { connectorKey: _connectorKey, ...encryptedPayload } = encrypted;
      await prisma.aiConnectorCredential.upsert({ where: { connectorId: row.id }, update: encryptedPayload, create: { connectorId: row.id, ...encryptedPayload } });
    }
    const saved = await prisma.aiConnector.findUnique({ where: { id: row.id }, include: { credential: { select: { id: true } } } });
    return NextResponse.json({ connector: saved ? safeConnector(saved) : null }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_body") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid connector fields", issues: error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
    return unavailable();
  }
}

export async function POST(request: Request): Promise<NextResponse> { return handleConnectorPost(request); }
