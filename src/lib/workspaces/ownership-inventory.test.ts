import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
);
const schemaPath = resolve(repositoryRoot, "prisma/schema.prisma");
const inventoryPath = resolve(
    repositoryRoot,
    "docs/security/workspace-ownership.csv.md",
);

const MODEL_DECLARATION = /^model\s+(\w+)/gm;
const ENUM_DECLARATION = /^enum\s+(\w+)/gm;
const INVENTORY_HEADER = [
    "model",
    "ownership",
    "parent",
    "workspaceKey",
    "notes",
];
const CANONICAL_OWNERSHIP = new Set([
    "workspace-key",
    "workspace-derived",
    "organization-global",
    "personal-with-workspace-link",
]);

type InventoryRow = {
    model: string;
    ownership: string;
    parent: string;
    workspaceKey: string;
    notes: string;
};

function readSchema(): string {
    return readFileSync(schemaPath, "utf8");
}

function schemaModels(): string[] {
    return Array.from(
        readSchema().matchAll(MODEL_DECLARATION),
        (match) => match[1],
    );
}

function schemaEnums(): string[] {
    return Array.from(
        readSchema().matchAll(ENUM_DECLARATION),
        (match) => match[1],
    );
}

function parseCsv(csv: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < csv.length; index += 1) {
        const character = csv[index];

        if (character === '"') {
            if (quoted && csv[index + 1] === '"') {
                field += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (character === "," && !quoted) {
            row.push(field);
            field = "";
        } else if (character === "\n" && !quoted) {
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else if (character !== "\r") {
            field += character;
        }
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

function inventoryRows(): InventoryRow[] {
    const markdown = readFileSync(inventoryPath, "utf8");
    const csvBlock = markdown.match(/```csv\s*\r?\n([\s\S]*?)\r?\n```/);

    if (!csvBlock) {
        throw new Error("workspace ownership inventory must contain a csv fence");
    }

    const [header, ...records] = parseCsv(csvBlock[1]);
    expect(header).toEqual(INVENTORY_HEADER);

    return records.map((record, index) => {
        expect(record, `CSV row ${index + 2} must have five columns`).toHaveLength(
            INVENTORY_HEADER.length,
        );

        return {
            model: record[0],
            ownership: record[1],
            parent: record[2],
            workspaceKey: record[3],
            notes: record[4],
        };
    });
}

describe("workspace ownership inventory", () => {
    it("inventory covers every prisma model", () => {
        const models = schemaModels();
        const rows = inventoryRows();

        // Keep the schema parser honest as the inventory gate evolves.
        expect(schemaEnums()).toHaveLength(41);

        const inventoryModels = rows.map((row) => row.model);
        expect(new Set(inventoryModels).size).toBe(inventoryModels.length);
        expect(inventoryModels).toEqual(expect.arrayContaining(models));
        expect(rows).toHaveLength(models.length);
    });

    it("ownership values are canonical", () => {
        for (const row of inventoryRows()) {
            expect(CANONICAL_OWNERSHIP.has(row.ownership)).toBe(true);
        }
    });

    it("every derived model chains to a workspace-keyed root", () => {
        const rows = inventoryRows();
        const byModel = new Map(rows.map((row) => [row.model, row]));

        for (const row of rows.filter(
            (candidate) => candidate.ownership === "workspace-derived",
        )) {
            const parents = row.parent
                .split("/")
                .map((parent) => parent.trim())
                .filter(Boolean);

            expect(parents.length, `${row.model} must name a parent`).toBeGreaterThan(
                0,
            );

            for (const parentName of parents) {
                const parent = byModel.get(parentName);
                expect(parent, `${row.model} names unknown parent ${parentName}`).toBeDefined();
                expect(
                    ["workspace-key", "workspace-derived"],
                    `${row.model} must chain through ${parentName}`,
                ).toContain(parent?.ownership);
            }
        }
    });
});
