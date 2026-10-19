import { describe, expect, it } from "vitest";
import { VIEW_TEMPLATES } from "@/lib/view-templates";
import {
    createSavedViewSchema,
    updateSavedViewSchema,
} from "./schemas";

const expectedUpdatedAt = "2026-10-08T00:00:00.000Z";

function blocksJson(blocks: unknown[]): string {
    return JSON.stringify({ blocks });
}

describe("saved-view block persistence schemas", () => {
    it("accept every current view template through the real create and update schemas", () => {
        expect(VIEW_TEMPLATES).toHaveLength(6);

        for (const template of VIEW_TEMPLATES) {
            const rawBlocksJson = blocksJson(template.blocks);
            const create = createSavedViewSchema.safeParse({
                name: template.name,
                scope: "TEAM",
                blocksJson: rawBlocksJson,
            });
            const update = updateSavedViewSchema.safeParse({
                blocksJson: rawBlocksJson,
                expectedUpdatedAt,
            });

            expect(create.success, `${template.id} create schema`).toBe(true);
            expect(update.success, `${template.id} update schema`).toBe(true);
        }
    });

    it("accepts a legacy block after list controls keep legacy filter values scalar", () => {
        const editedLegacyBlock = {
            id: "legacy-task-view",
            type: "taskView",
            viewType: "table",
            filters: {
                status: "TODO",
                assigneeIds: "user-1,@me",
                tagIds: "tag-old,tag-new",
                legacyKey: "preserve-me",
            },
            projectIds: ["project-1"],
            sortBy: "dueAt",
        };
        const rawBlocksJson = blocksJson([editedLegacyBlock]);

        expect(createSavedViewSchema.safeParse({
            name: "Legacy edited view",
            scope: "PERSONAL",
            blocksJson: rawBlocksJson,
        }).success).toBe(true);
        expect(updateSavedViewSchema.safeParse({
            blocksJson: rawBlocksJson,
            expectedUpdatedAt,
        }).success).toBe(true);
    });

    it("continues rejecting array-valued legacy filters instead of loosening the strict schema", () => {
        const result = createSavedViewSchema.safeParse({
            name: "Invalid legacy shape",
            scope: "PERSONAL",
            blocksJson: blocksJson([{
                id: "legacy-task-view",
                type: "taskView",
                filters: { assigneeIds: ["user-1", "@me"] },
            }]),
        });

        expect(result.success).toBe(false);
    });
});
