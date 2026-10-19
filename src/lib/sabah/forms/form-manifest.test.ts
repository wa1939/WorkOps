import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    SABAH_FORM_MANIFEST,
    type SabahFormClassification,
} from "./form-manifest";

const EXPECTED_MODULES = [
    "pmo",
    "notes",
    "leave",
    "caseStudies",
    "reports",
    "support",
    "savedViews",
    "notifications",
    "team",
] as const;

const FORBIDDEN_TERMS = /\b(?:password|users?|admin|roles?|backup|database|credentials?|config|announcement|publish|delete|send)\b/i;

describe("Sabah reviewed form manifest", () => {
    it("covers every reviewed operational module with concrete surfaces", () => {
        const modules = new Set(SABAH_FORM_MANIFEST.map((entry) => entry.module));
        expect(Array.from(modules)).toEqual(EXPECTED_MODULES);
        expect(SABAH_FORM_MANIFEST.length).toBeGreaterThanOrEqual(20);

        const ids = SABAH_FORM_MANIFEST.map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);

        for (const entry of SABAH_FORM_MANIFEST) {
            expect(entry.id.trim()).not.toBe("");
            expect(entry.path.trim()).not.toBe("");
            expect(entry.title.trim()).not.toBe("");
            expect(["field-assisted", "chat-context-only", "dedicated-ui-only"] satisfies SabahFormClassification[]).toContain(entry.classification);
            expect(entry.capabilities.length).toBeGreaterThan(0);
            expect(entry.capabilities.every((name) => name.trim() !== "")).toBe(true);
            expect(existsSync(join(process.cwd(), entry.path))).toBe(true);
            if (entry.classification === "field-assisted") {
                expect(entry.fields?.length).toBeGreaterThan(0);
            }
        }
    });

    it("records PMO fields and keeps empty-descriptor forms chat-context-only", () => {
        const pmo = SABAH_FORM_MANIFEST.filter((entry) => entry.module === "pmo");
        expect(pmo.filter((entry) => entry.classification === "field-assisted").map((entry) => entry.id)).toEqual([
            "pmo-action-create",
            "pmo-action-edit",
        ]);
        expect(pmo.find((entry) => entry.id === "pmo-action-create")?.fields).toEqual([
            "parent",
            "title",
            "description",
            "ownerId",
            "externalContactId",
            "dueDate",
            "priority",
            "reminderAt",
            "overdueIntervalMinutes",
        ]);
        expect(SABAH_FORM_MANIFEST.find((entry) => entry.id === "notes-create")?.classification).toBe("chat-context-only");
        expect(SABAH_FORM_MANIFEST.find((entry) => entry.id === "notes-edit")?.classification).toBe("chat-context-only");
    });

    it("contains no forbidden boundary terms", () => {
        expect(JSON.stringify(SABAH_FORM_MANIFEST)).not.toMatch(FORBIDDEN_TERMS);
    });
});
