import { describe, expect, it } from "vitest";
import {
    deserializeFilterState,
    serializeFilterState,
    type FilterSchema,
} from "./use-filter-persistence";

describe("filter persistence serialization", () => {
    const schema = {
        assigneeIds: [] as string[],
        query: "",
        includeArchived: false,
    } satisfies FilterSchema;

    it("round-trips arrays, strings, and booleans", () => {
        const filters = {
            assigneeIds: ["member-1", "member-2"],
            query: "planning & delivery",
            includeArchived: true,
        };

        const serialized = serializeFilterState(filters);

        expect(deserializeFilterState(serialized, schema)).toEqual(filters);
    });

    it("omits empty strings and empty arrays while preserving false booleans", () => {
        const serialized = serializeFilterState({
            assigneeIds: [],
            query: "",
            includeArchived: false,
        });

        expect(serialized).toBe("includeArchived=false");
        expect(deserializeFilterState(serialized, schema)).toEqual({
            assigneeIds: [],
            query: "",
            includeArchived: false,
        });
    });

    it("reads repeated array parameters and falls back to schema defaults", () => {
        const filters = deserializeFilterState(
            "assigneeIds=member-1&assigneeIds=member-2&includeArchived=true",
            schema,
        );

        expect(filters).toEqual({
            assigneeIds: ["member-1", "member-2"],
            query: "",
            includeArchived: true,
        });
    });
});
