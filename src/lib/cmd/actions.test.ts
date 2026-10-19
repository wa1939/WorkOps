import { describe, expect, it } from "vitest";
import { filterCommands, type CommandDefinition } from "./actions";

const commands: CommandDefinition[] = [
    {
        id: "tasks",
        label: "Tasks",
        description: "Open the task workspace",
        keywords: ["work", "todo"],
    },
    {
        id: "new-project",
        label: "New project",
        description: "Create a project",
        keywords: ["create", "quick action"],
    },
    {
        id: "theme",
        label: "Toggle theme",
        description: "Switch between light and dark mode",
    },
];

describe("filterCommands", () => {
    it("returns all commands for an empty query", () => {
        expect(filterCommands(commands, "")).toEqual(commands);
    });

    it("matches labels, descriptions, and keywords case-insensitively", () => {
        expect(filterCommands(commands, "TODO")).toEqual([commands[0]]);
        expect(filterCommands(commands, "dark mode")).toEqual([commands[2]]);
        expect(filterCommands(commands, "quick create")).toEqual([commands[1]]);
    });

    it("requires every query term to match the command text", () => {
        expect(filterCommands(commands, "new dark")).toEqual([]);
    });
});
