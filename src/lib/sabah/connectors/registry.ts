import { CONNECTOR_DIRECTIONS, type ConnectorDefinition, type ConnectorHandler } from "./contracts";
import { SABAH_LIFECYCLE_EVENT_NAMES, type SabahLifecycleEventName } from "../events/contracts";

const keyPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,62}$/;
const versionPattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const capabilityPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
export function isValidConnectorKey(key: unknown): key is string { return typeof key === "string" && key.length <= 64 && keyPattern.test(key); }
const eventNames = new Set<string>(SABAH_LIFECYCLE_EVENT_NAMES);

function keyOf(key: string, version: string): string { return `${key}@${version}`; }
function isHandler(value: unknown): value is ConnectorHandler { return typeof value === "function"; }

export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorDefinition>();
  register(definition: ConnectorDefinition): void {
    if (!isValidConnectorKey(definition.key) || !versionPattern.test(definition.version) || definition.version.length > 32) throw new Error("Invalid connector identity");
    if (definition.storedVersion !== undefined && (!Number.isSafeInteger(definition.storedVersion) || definition.storedVersion < 0 || definition.storedVersion > 1000)) throw new Error("Invalid stored connector version");
    if (!CONNECTOR_DIRECTIONS.includes(definition.direction) || typeof definition.enabled !== "boolean") throw new Error("Invalid connector direction");
    if (!Array.isArray(definition.supportedEvents) || definition.supportedEvents.some((event) => !eventNames.has(event))) throw new Error("Unsupported connector event");
    if (!Array.isArray(definition.supportedCapabilities) || definition.supportedCapabilities.length > 50 || definition.supportedCapabilities.some((capability) => typeof capability !== "string" || capability.length > 100 || !capabilityPattern.test(capability))) throw new Error("Unsupported connector capability");
    if (!definition.configSchema || typeof definition.configSchema.safeParse !== "function" || !definition.credentialSchema || typeof definition.credentialSchema.safeParse !== "function") throw new Error("Invalid connector schemas");
    if ((definition.direction === "INBOUND" || definition.direction === "BIDIRECTIONAL") && !isHandler(definition.inbound)) throw new Error("Inbound handler required");
    if ((definition.direction === "OUTBOUND" || definition.direction === "BIDIRECTIONAL") && !isHandler(definition.outbound)) throw new Error("Outbound handler required");
    if ("endpoint" in definition && definition.endpoint !== undefined) throw new Error("Arbitrary endpoints are not allowed");
    const identity = keyOf(definition.key, definition.version);
    if (this.connectors.has(identity)) throw new Error(`${identity} already registered`);
    this.connectors.set(identity, Object.freeze({ ...definition, supportedEvents: Object.freeze([...definition.supportedEvents]), supportedCapabilities: Object.freeze([...definition.supportedCapabilities]) }));
  }
  resolve(key: string, version: string): ConnectorDefinition {
    const result = this.connectors.get(keyOf(key, version));
    if (!result) throw new Error(`Connector not found: ${keyOf(key, version)}`);
    return result;
  }
  resolveStoredVersion(key: string, storedVersion: number): ConnectorDefinition | null {
    if (!Number.isSafeInteger(storedVersion) || storedVersion < 0 || storedVersion > 1000) return null;
    return this.list().find((definition) => definition.key === key && definition.storedVersion === storedVersion) ?? null;
  }
  list(): ConnectorDefinition[] { return Array.from(this.connectors.values()).sort((a, b) => keyOf(a.key, a.version).localeCompare(keyOf(b.key, b.version))); }
  async validateConfig(key: string, version: string, config: unknown): Promise<unknown> { return this.resolve(key, version).configSchema.parse(config); }
  async validateCredentials(key: string, version: string, credentials: unknown): Promise<unknown> { return this.resolve(key, version).credentialSchema.parse(credentials); }
  async deliver(key: string, version: string, input: { name: SabahLifecycleEventName; payload?: unknown }): Promise<unknown> {
    const connector = this.resolve(key, version);
    if (!connector.enabled) throw new Error("Connector is disabled");
    if (!connector.supportedEvents.includes(input.name)) throw new Error("Connector does not support event");
    if (!connector.outbound) throw new Error("Connector has no outbound handler");
    return connector.outbound(input);
  }
  async receive(key: string, version: string, input: { name: SabahLifecycleEventName; payload?: unknown }): Promise<unknown> {
    const connector = this.resolve(key, version);
    if (!connector.enabled) throw new Error("Connector is disabled");
    if (!connector.supportedEvents.includes(input.name)) throw new Error("Connector does not support event");
    if (!connector.inbound) throw new Error("Connector has no inbound handler");
    return connector.inbound(input);
  }
}

/** Process-local registry populated by the application's connector registrations. */
export const connectorRegistry = new ConnectorRegistry();
