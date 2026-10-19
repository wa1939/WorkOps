import { describe, expect, it } from "vitest";
import { OPERATIONAL_MODULE_MANIFEST } from "./module-manifest";
import { registerOperationalCapabilities } from "./register-operational";
import { CapabilityRegistry } from "./registry";

const EXPECTED_CAPABILITIES = {
    pmo: [
        "pmo.actions.search",
        "pmo.actions.get",
        "pmo.actions.create",
        "pmo.actions.update",
        "pmo.actions.addEvidence",
        "pmo.actions.addFollowUp",
        "pmo.actions.recordResponse",
        "pmo.actions.changeLifecycle",
        "pmo.contacts.search",
        "pmo.contacts.create",
        "pmo.contacts.update",
        "pmo.workAreas.search",
        "pmo.workAreas.create",
        "pmo.workAreas.update",
        "pmo.drafts.generate",
        "pmo.drafts.rewrite",
    ],
    notes: [
        "notes.search",
        "notes.get",
        "notes.create",
        "notes.update",
        "notes.summarize",
        "notes.convertToActions",
    ],
    leave: [
        "leave.searchMine",
        "leave.getMine",
        "leave.draft",
        "leave.create",
        "leave.updateHandover",
        "leave.prepareReturnReport",
    ],
    caseStudies: [
        "caseStudies.search",
        "caseStudies.get",
        "caseStudies.create",
        "caseStudies.update",
        "caseStudies.planTasks",
    ],
    reports: [
        "reports.search",
        "reports.get",
        "reports.generateDraft",
        "reports.enhance",
        "reports.compare",
        "reports.finalize",
    ],
    support: ["support.search", "support.create", "support.claim"],
    savedViews: [
        "savedViews.search",
        "savedViews.create",
        "savedViews.update",
        "savedViews.vote",
    ],
    notifications: [
        "notifications.listMine",
        "notifications.markRead",
        "notifications.markAllRead",
        "notifications.summarize",
    ],
    team: [
        "team.members",
        "team.capacity",
        "team.assignmentCandidates",
        "team.proposeRebalance",
    ],
} as const;

const normalizeManifestForSafetyScan = (manifest: typeof OPERATIONAL_MODULE_MANIFEST) =>
    JSON.stringify(manifest)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .toLowerCase();

describe("operational module manifest", () => {
    it("maps every approved operational module to capabilities and form surfaces", () => {
        expect(OPERATIONAL_MODULE_MANIFEST.map((item) => item.module)).toEqual([
            "pmo",
            "notes",
            "leave",
            "caseStudies",
            "reports",
            "support",
            "savedViews",
            "notifications",
            "team",
        ]);

        for (const manifestModule of OPERATIONAL_MODULE_MANIFEST) {
            expect(manifestModule.capabilities.length).toBeGreaterThan(0);
            expect(manifestModule.sourceRoutes.length).toBeGreaterThan(0);
            expect(manifestModule.formSurfaces.length).toBeGreaterThan(0);

            for (const entry of [
                ...manifestModule.capabilities,
                ...manifestModule.sourceRoutes,
                ...manifestModule.formSurfaces,
            ]) {
                expect(entry.trim()).not.toBe("");
            }

            expect(manifestModule.capabilities).toEqual(EXPECTED_CAPABILITIES[manifestModule.module]);
            expect(manifestModule.ownerTask).toMatch(/^Task [2-9]$/);
            expect(manifestModule.plan).toBe("2026-08-24-sabah-operational-parity");
        }
    });

    it("registers every reviewed capability once in the reviewed module order", () => {
        const registry = new CapabilityRegistry();
        const registrations: string[] = [];
        const recordingRegistry = {
            register(definition: { name: string }) {
                registrations.push(definition.name);
                registry.register(definition as never);
            },
        };

        registerOperationalCapabilities(recordingRegistry);
        registerOperationalCapabilities(recordingRegistry);

        const expected = OPERATIONAL_MODULE_MANIFEST.flatMap((module) => [...module.capabilities]);
        expect(registrations.slice(-expected.length)).toEqual(expected);
        expect(new Set(registrations).size).toBe(registrations.length);
        for (const name of expected) expect(registry.resolve(name)).toBeDefined();
    });

    it("contains no prohibited safety-boundary terms anywhere in the manifest", () => {
        const serializedManifest = normalizeManifestForSafetyScan(OPERATIONAL_MODULE_MANIFEST);

        expect(serializedManifest).not.toMatch(
            /\b(?:delete|auth|access|password|role|backup|database|credentials?|production\s+configuration|send\s+email)\b/i,
        );
    });
});
