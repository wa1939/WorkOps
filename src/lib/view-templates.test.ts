import { describe, expect, it } from "vitest";
import { VIEW_TEMPLATES } from "./view-templates";

describe("Sabah custom view template", () => {
    it("registers a distinct assistant-centric featured template without replacing legacy templates", () => {
        const sabah = VIEW_TEMPLATES.find((template) => template.id === "sabah-workspace");

        expect(VIEW_TEMPLATES.map((template) => template.id)).toEqual(expect.arrayContaining([
            "executive-dashboard",
            "project-war-room",
            "team-okrs",
            "daily-standup",
            "weekly-report",
            "sabah-workspace",
        ]));
        expect(sabah).toMatchObject({
            name: "Sabah Workspace",
            icon: "sabah",
            tagline: expect.stringContaining("Sabah"),
        });
        expect(sabah?.blocks.filter((block) => block.type === "assistantWorkspace")).toEqual([
            expect.objectContaining({ type: "assistantWorkspace", assistantLayout: "context", assistantAccent: "sky" }),
        ]);
    });
});
