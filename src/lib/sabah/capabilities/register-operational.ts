import type { CapabilityRegistry } from "./registry";
import { registerCoreWorkCapabilities } from "./register-core-work";
import { registerPmoCapabilities } from "./modules/pmo";
import { registerNotesCapabilities } from "./modules/notes";
import { registerLeaveCapabilities } from "./modules/leave";
import { registerCaseStudyCapabilities } from "./modules/case-studies";
import { registerReportCapabilities } from "./modules/reports";
import { registerSupportCapabilities } from "./modules/support";
import { registerSavedViewCapabilities } from "./modules/saved-views";
import { registerNotificationCapabilities } from "./modules/notifications";
import { registerTeamCapabilities } from "./modules/team";
import { registerWorkAssistanceCapabilities } from "./modules/work-assistance";

const registeredRegistries = new WeakSet<object>();

/** Register the reviewed operational surface without importing unfinished modules. */
export function registerOperationalCapabilities(registry: { register: (definition: any) => void }): void {
  if (registeredRegistries.has(registry)) return;
  registerWorkAssistanceCapabilities(registry);
  registerCoreWorkCapabilities(registry);
  registerPmoCapabilities(registry);
  registerNotesCapabilities(registry);
  registerLeaveCapabilities(registry);
  registerCaseStudyCapabilities(registry);
  registerReportCapabilities(registry);
  registerSupportCapabilities(registry);
  registerSavedViewCapabilities(registry);
  registerNotificationCapabilities(registry);
  registerTeamCapabilities(registry);
  registeredRegistries.add(registry);
}
