import type { CapabilityRegistry } from "./registry";
import { registerProjectCapabilities } from "./modules/projects";
import { registerTaskCapabilities } from "./modules/tasks";
import { registerKpiCapabilities } from "./modules/kpis";

const registeredRegistries = new WeakSet<object>();

/** Register the core surface once per registry; real duplicate versions still throw in the registry. */
export function registerCoreWorkCapabilities(registry: { register: (definition: never) => void }): void {
    if (registeredRegistries.has(registry)) return;
    const boundRegistry = { register: (definition: never) => registry.register(definition) };
    registerProjectCapabilities(boundRegistry);
    registerTaskCapabilities(boundRegistry);
    registerKpiCapabilities(boundRegistry);
    registeredRegistries.add(registry);
}
