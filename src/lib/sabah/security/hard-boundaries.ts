const blockedPatterns = [
  "roles?", "access", "password", "auth", "backup", "database", "migration",
  "production", "config(?:uration)?", "delete", "credentials?", "pmo\\s+(?:email|send)",
] as const;

/** Immutable, fail-closed capability-name fragments. */
export const HARD_BLOCKED_PATTERNS: readonly string[] = Object.freeze([...blockedPatterns]);

export function assertCapabilityAllowed(name: string): void {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Capability name is required and blocked by default");
  }
  const normalized = name.trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
  if (HARD_BLOCKED_PATTERNS.some((pattern) => new RegExp(`(?:^|\\s)${pattern}(?:$|\\s)`, "i").test(normalized))) {
    throw new Error(`Capability ${name} is blocked by immutable security boundary`);
  }
}
