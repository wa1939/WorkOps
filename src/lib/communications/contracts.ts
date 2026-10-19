export const DELIVERY_STATES = [
  "PENDING",
  "SENDING",
  "ACCEPTED",
  "DELIVERED",
  "FAILED",
  "BOUNCED",
  "SUPPRESSED",
  "EXPIRED",
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const TERMINAL_DELIVERY_STATES: readonly DeliveryState[] = [
  "DELIVERED",
  "BOUNCED",
  "SUPPRESSED",
  "EXPIRED",
] as const;

const ALLOWED_TRANSITIONS: Record<DeliveryState, readonly DeliveryState[]> = {
  PENDING: ["SENDING", "SUPPRESSED", "EXPIRED"],
  SENDING: ["ACCEPTED", "FAILED", "BOUNCED", "SUPPRESSED", "EXPIRED", "PENDING"],
  ACCEPTED: ["DELIVERED", "BOUNCED"],
  FAILED: ["PENDING"],
  DELIVERED: [],
  BOUNCED: [],
  SUPPRESSED: [],
  EXPIRED: [],
};

function isDeliveryState(value: unknown): value is DeliveryState {
  return typeof value === "string" && (DELIVERY_STATES as readonly string[]).includes(value);
}

export function canTransition(from: DeliveryState, to: DeliveryState): boolean {
  if (!isDeliveryState(from) || !isDeliveryState(to) || from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}
