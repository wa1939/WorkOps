import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decryptConnectorCredential } from "@/lib/sabah/connectors/crypto";
import { registerBuiltinConnectors } from "@/lib/sabah/connectors/builtins";
import { connectorRegistry } from "@/lib/sabah/connectors/registry";
import { SABAH_LIFECYCLE_EVENT_NAMES, type SabahLifecycleEventName } from "@/lib/sabah/events/contracts";
import type { DeliveryStore } from "../../../../../../lib/sabah/connectors/delivery";
import type { VerifiedInboundConnector } from "../../../../../../lib/sabah/connectors/adapters/webhook";

export type WebhookRuntime = { resolveConnector(connectorKey: string): Promise<VerifiedInboundConnector | null> };
type ConnectorRow = { id: string; key: string; version: number; direction: string; enabled: boolean; eventType: string; credential: { encryptedValue: string; iv: string; authTag: string; keyVersion: number } | null };
let runtime: WebhookRuntime | null = null;

function localPort(): number {
  const text = process.env.SABAH_PLAN10_CONTROL_PORT ?? "4010";
  if (!/^\d{1,5}$/.test(text)) throw new Error("Invalid local control port");
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid local control port");
  return port;
}

async function postLocal(path: string, value: Record<string, string>): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`http://127.0.0.1:${localPort()}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(value), signal: controller.signal });
    const text = await response.text();
    if (!response.ok || text.length > 8_192) throw new Error("Local webhook control failed");
  } finally { clearTimeout(timer); }
}

function deliveryStore(connectorId: string, eventType: string): DeliveryStore {
  return {
    async claimReplay(replayId) {
      const payloadHash = createHash("sha256").update(replayId, "utf8").digest("hex");
      try {
        await prisma.aiWebhookDelivery.create({ data: { connectorId, eventType, replayKey: replayId, payloadHash, status: "PENDING" } });
        return true;
      } catch {
        try {
          const reopened = await prisma.aiWebhookDelivery.updateMany({ where: { connectorId, replayKey: replayId, status: "RETRY_WAIT" }, data: { status: "PENDING", errorMessage: null, attemptCount: { increment: 1 } } });
          return reopened.count === 1;
        } catch { return false; }
      }
    },
    async releaseReplay(replayId) {
      await prisma.aiWebhookDelivery.updateMany({ where: { connectorId, replayKey: replayId, status: "PENDING" }, data: { status: "RETRY_WAIT", errorMessage: "inbound_sink_failed" } });
    },
    async recordDelivery(record) {
      const status = record.outcome === "delivered" ? "DELIVERED" : record.outcome === "circuit_open" ? "CANCELED" : record.outcome === "retry_exhausted" ? "RETRY_WAIT" : "FAILED";
      await prisma.aiWebhookDelivery.updateMany({ where: { connectorId, replayKey: record.replayId }, data: { status, attemptCount: record.attempts, responseHash: record.bodyHash, errorMessage: record.outcome === "delivered" ? null : record.outcome } });
    },
  };
}

const localRuntime: WebhookRuntime = {
  async resolveConnector(connectorKey) {
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,62}$/.test(connectorKey)) return null;
    registerBuiltinConnectors();
    let row: ConnectorRow | null;
    try { row = await prisma.aiConnector.findFirst({ where: { key: connectorKey }, orderBy: { version: "desc" }, include: { credential: true } }); } catch { return null; }
    if (!row || !row.enabled || !row.credential || (row.direction !== "INBOUND" && row.direction !== "BIDIRECTIONAL")) return null;
    const definition = connectorRegistry.resolveStoredVersion(row.key, row.version);
    const event = SABAH_LIFECYCLE_EVENT_NAMES.find((candidate) => candidate === row.eventType);
    const masterKey = process.env.SABAH_CREDENTIAL_KEY;
    if (!definition || definition.storedVersion !== row.version || !event || !masterKey) return null;
    let secret: string;
    try { secret = decryptConnectorCredential({ ...row.credential, connectorKey: row.key }, masterKey); } catch { return null; }
    if (!secret || secret.length > 4_096) return null;
    const store = deliveryStore(row.id, event);
    return {
      connectorKey: row.key,
      enabled: row.enabled,
      direction: row.direction,
      allowedEvents: [event] as readonly SabahLifecycleEventName[],
      secret,
      store,
      suggestionSink: async (suggestion) => postLocal("/connector/inbound", { connectorKey: suggestion.connectorKey ?? row.key, eventId: suggestion.eventId, event: suggestion.event, status: "OPEN" }),
    };
  },
};

export function getWebhookRuntime(): WebhookRuntime | null {
  if (runtime) return runtime;
  return process.env.SABAH_PLAN10_LOCAL_RUNTIME === "1" ? localRuntime : null;
}

export function setWebhookRuntimeForTests(value: WebhookRuntime | null): void {
  runtime = value;
}
