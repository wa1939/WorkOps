import { describe, expect, it } from "vitest";
import { taskGridWindow } from "./grid-window";

describe("task grid render window", () => {
    it("keeps tasks beyond the rendering cap reachable", () => {
        const rows = Array.from({ length: 251 }, (_, id) => ({ id }));
        expect(taskGridWindow(rows, 0).rows).toHaveLength(200);
        expect(taskGridWindow(rows, 1).rows[0].id).toBe(200);
        expect(taskGridWindow(rows, 1).rows.at(-1)?.id).toBe(250);
    });
    it("clamps a stale page after a filter reduces results", () => {
        expect(taskGridWindow([{ id: "only" }], 4)).toMatchObject({ page: 0, pages: 1, rows: [{ id: "only" }] });
    });
});
