import { connectorRegistry } from "@/lib/sabah/connectors/registry";
import { registerBuiltinConnectors } from "@/lib/sabah/connectors/builtins";
import type { ConnectorDefinition } from "@/lib/sabah/connectors/contracts";

export type SignedWebhookTestTransport = (input: { connectorId: string; eventType: string; config: unknown }) => Promise<{ code: "delivered" | "unavailable" | "failed" }>;
export type VerifiedConnectorDefinition = ConnectorDefinition & { kind: string; dataPolicy: string; storedVersion: number };
export type ConnectorRuntime = { masterKey?: string; resolveConnector?: (key: string, version: number) => Promise<VerifiedConnectorDefinition | null>; testTransport?: SignedWebhookTestTransport };

registerBuiltinConnectors();
const productionResolver = async (key: string, storedVersion: number): Promise<VerifiedConnectorDefinition | null> => {
  const definition = connectorRegistry.resolveStoredVersion(key, storedVersion);
  if (!definition || definition.storedVersion !== storedVersion || typeof definition.kind !== "string" || typeof definition.dataPolicy !== "string") return null;
  return { ...definition, kind: definition.kind, dataPolicy: definition.dataPolicy, storedVersion: definition.storedVersion };
};
let runtime: ConnectorRuntime = { resolveConnector: productionResolver };

export function getConnectorRuntime(): ConnectorRuntime { return runtime; }
export function setConnectorRuntime(next: ConnectorRuntime): void { runtime = { resolveConnector: productionResolver, ...next }; }
