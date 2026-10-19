import { describe, expect, it } from "vitest";
import { SetupRefused, initDatabase } from "./init-core";

function makeClient(tableCount: number, hasMigrations: boolean) {
    return {
        $queryRawUnsafe: async <T>(sql: string): Promise<T> => {
            const count = sql.includes("_prisma_migrations")
                ? hasMigrations
                    ? 1
                    : 0
                : tableCount;
            return [{ count }] as T;
        },
        $disconnect: async () => {},
    };
}

const okDeps = {
    databaseUrl: "postgresql://workops:secret@127.0.0.1:5432/workops?schema=public",
    runMigrateDeploy: () => ({ status: 0 }),
    confirm: async () => true,
    log: () => {},
};

describe("initDatabase", () => {
    it("runs migrate deploy on an empty database after confirmation", async () => {
        let deployRan = false;
        const lines: string[] = [];
        const result = await initDatabase({
            ...okDeps,
            client: makeClient(0, false),
            runMigrateDeploy: () => {
                deployRan = true;
                return { status: 0 };
            },
            log: (line) => lines.push(line),
        });
        expect(result).toEqual({ state: "empty", migrated: true });
        expect(deployRan).toBe(true);
        // The target echo must never contain the password.
        expect(lines.join("\n")).not.toContain("secret");
        expect(lines.join("\n")).toContain("***");
    });

    it("refuses an existing WorkOps install without running any SQL writes", async () => {
        let deployRan = false;
        await expect(
            initDatabase({
                ...okDeps,
                client: makeClient(40, true),
                runMigrateDeploy: () => {
                    deployRan = true;
                    return { status: 0 };
                },
            }),
        ).rejects.toMatchObject({ name: "SetupRefused", reason: "existing-workops" });
        expect(deployRan).toBe(false);
    });

    it("refuses an unknown non-empty schema", async () => {
        let deployRan = false;
        await expect(
            initDatabase({
                ...okDeps,
                client: makeClient(7, false),
                runMigrateDeploy: () => {
                    deployRan = true;
                    return { status: 0 };
                },
            }),
        ).rejects.toBeInstanceOf(SetupRefused);
        expect(deployRan).toBe(false);
    });

    it("aborts without writing when the user declines", async () => {
        let deployRan = false;
        await expect(
            initDatabase({
                ...okDeps,
                client: makeClient(0, false),
                confirm: async () => false,
                runMigrateDeploy: () => {
                    deployRan = true;
                    return { status: 0 };
                },
            }),
        ).rejects.toMatchObject({ reason: "aborted" });
        expect(deployRan).toBe(false);
    });

    it("surfaces a non-zero migrate deploy exit status", async () => {
        await expect(
            initDatabase({
                ...okDeps,
                client: makeClient(0, false),
                runMigrateDeploy: () => ({ status: 1 }),
            }),
        ).rejects.toThrow("exited with status 1");
    });
});
