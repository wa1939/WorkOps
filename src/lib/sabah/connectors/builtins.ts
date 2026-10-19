import { z } from "zod";
import { SABAH_LIFECYCLE_EVENT_NAMES } from "../events/contracts";
import { connectorRegistry, ConnectorRegistry } from "./registry";
import type { ConnectorDefinition } from "./contracts";

const CONNECTOR_KEY = "sabah.webhook";
const CONNECTOR_VERSION = "1.0.0";
const MAX_PATH_LENGTH = 256;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const hostPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const pathPattern = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
const payloadValue = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]);
const payloadSchema = z.record(z.string().min(1).max(64), payloadValue).superRefine((payload, context) => {
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_PAYLOAD_BYTES) context.addIssue({ code: z.ZodIssueCode.custom, message: "Payload is too large" });
});
const lifecycleInputSchema = z.object({ name: z.enum(SABAH_LIFECYCLE_EVENT_NAMES), payload: payloadSchema.optional() }).strict();
type LifecycleInput = z.infer<typeof lifecycleInputSchema>;

const configSchema = z.object({
  host: z.string().trim().min(1).max(253).regex(hostPattern, "Invalid webhook host"),
  path: z.string().min(1).max(MAX_PATH_LENGTH).regex(pathPattern, "Path must be absolute"),
}).strict().superRefine((config, context) => {
  const allowedHosts = (process.env.SABAH_WEBHOOK_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (allowedHosts.length === 0 || !allowedHosts.includes(config.host.toLowerCase())) context.addIssue({ code: z.ZodIssueCode.custom, path: ["host"], message: "Webhook host is not allowed" });
});
const credentialSchema = z.string().trim().min(1).max(4096);

type DeliveryRequest = { kind: "delivery_request"; draftOnly: true; connectorKey: string; event: LifecycleInput };
type InboundSuggestion = { kind: "inbound_suggestion"; draftOnly: true; connectorKey: string; event: LifecycleInput };

function parseInput(input: unknown): LifecycleInput {
  return lifecycleInputSchema.parse(input);
}

const definition: ConnectorDefinition = Object.freeze({
  key: CONNECTOR_KEY,
  version: CONNECTOR_VERSION,
  storedVersion: 1,
  kind: "webhook",
  direction: "BIDIRECTIONAL",
  dataPolicy: "INTERNAL",
  dataClassification: "INTERNAL",
  supportedEvents: SABAH_LIFECYCLE_EVENT_NAMES,
  supportedCapabilities: ["tasks.create"],
  configSchema,
  credentialSchema,
  enabled: true,
  inbound: (input: unknown): InboundSuggestion => ({ kind: "inbound_suggestion", draftOnly: true, connectorKey: CONNECTOR_KEY, event: parseInput(input) }),
  outbound: (input: unknown): DeliveryRequest => ({ kind: "delivery_request", draftOnly: true, connectorKey: CONNECTOR_KEY, event: parseInput(input) }),
});

const registeredRegistries = new WeakSet<ConnectorRegistry>();
export function registerBuiltinConnectors(registry: ConnectorRegistry = connectorRegistry): void {
  if (registeredRegistries.has(registry)) return;
  let existing: ConnectorDefinition | null = null;
  try { existing = registry.resolve(CONNECTOR_KEY, CONNECTOR_VERSION); } catch { /* absent */ }
  if (existing) throw new Error(`${CONNECTOR_KEY}@${CONNECTOR_VERSION} conflicts with built-in connector`);
  registry.register(definition);
  registeredRegistries.add(registry);
}

export { definition as sabahWebhookConnector };
