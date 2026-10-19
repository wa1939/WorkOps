import { registerWorkspaceCapabilities } from "./modules/workspace";
import type { CapabilityRegistry } from "./registry";

const registeredRegistries = new WeakSet<object>();
export function registerWorkspaceCapabilitySet(registry: CapabilityRegistry): void {
  if (registeredRegistries.has(registry)) return;
  registerWorkspaceCapabilities(registry);
  registeredRegistries.add(registry);
}
