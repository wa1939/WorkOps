import { describe, expect, it, vi } from "vitest";
import { deriveProjectPrefix, formatTaskKey, nextTaskKey, type TaskKeyDatabase } from "./key";

describe("task key formatting", () => {
    it("derives a three-character alphanumeric prefix from a project name", () => {
        expect(deriveProjectPrefix("  Alpha / 2026 ", "project-id")).toBe("ALP");
    });

    it("uses the project id when the name has no usable characters", () => {
        expect(deriveProjectPrefix("---", "p-9z-task")).toBe("P9Z");
    });

    it("falls back when neither project name nor id contains alphanumeric characters", () => {
        expect(deriveProjectPrefix("---", "---")).toBe("TSK");
    });

    it("formats and pads a task sequence", () => {
        expect(formatTaskKey("abc", 1)).toBe("ABC-0001");
        expect(formatTaskKey("abc", 42)).toBe("ABC-0042");
        expect(formatTaskKey("abc", 10000)).toBe("ABC-10000");
    });
});

describe("nextTaskKey", () => {
    it("increments the project counter and formats the returned sequence", async () => {
        const update = vi.fn().mockResolvedValue({ id: "project-1", name: "Research", taskSeq: 7 });
        const db = { project: { update } } as unknown as TaskKeyDatabase;

        await expect(nextTaskKey("project-1", db)).resolves.toBe("RES-0007");
        expect(update).toHaveBeenCalledWith({
            where: { id: "project-1" },
            data: { taskSeq: { increment: 1 } },
            select: { id: true, name: true, taskSeq: true },
        });
    });

    it("uses each database counter result so concurrent calls get distinct keys", async () => {
        let sequence = 0;
        const update = vi.fn(async () => ({
            id: "project-1",
            name: "Research",
            taskSeq: ++sequence,
        }));
        const db = { project: { update } } as unknown as TaskKeyDatabase;

        await expect(Promise.all([
            nextTaskKey("project-1", db),
            nextTaskKey("project-1", db),
        ])).resolves.toEqual(["RES-0001", "RES-0002"]);
        expect(update).toHaveBeenCalledTimes(2);
    });
});
