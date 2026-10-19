import { z } from "zod";
import { SABAH_LIFECYCLE_EVENT_NAMES, type SabahLifecycleEventName } from "../events/contracts";

export const CONNECTOR_DIRECTIONS = ["INBOUND", "OUTBOUND", "BIDIRECTIONAL"] as const;
export type ConnectorDirection = (typeof CONNECTOR_DIRECTIONS)[number];
export type DataClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
export type ConnectorHandler = (input: unknown) => Promise<unknown> | unknown;
export type ConnectorDefinition = {
  key: string;
  version: string;
  /** Integer version used by the persisted connector record, when registered. */
  storedVersion?: number;
  /** Persistence metadata owned by the registry policy. */
  kind?: string;
  dataPolicy?: string;
  supportedEvents: readonly SabahLifecycleEventName[];
  supportedCapabilities: readonly string[];
  direction: ConnectorDirection;
  configSchema: z.ZodType;
  credentialSchema: z.ZodType;
  dataClassification: DataClassification;
  policy?: string;
  enabled: boolean;
  inbound?: ConnectorHandler;
  outbound?: ConnectorHandler;
  endpoint?: unknown;
};
