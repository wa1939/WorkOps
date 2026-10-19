import { describe, expect, it } from "vitest";
import {
    classifyDatabase,
    HAS_MIGRATIONS_TABLE_SQL,
    COUNT_PUBLIC_TABLES_SQL,
    readDatabaseState,
} from "./classify-database";

describe("classifyDatabase", () => {
    it("treats zero tables as empty regardless of migration history flag", () => {
        expect(classifyDatabase(0, false)).toBe("empty");
    });

    it("classifies a database with WorkOps migration history as existing", () => {
        expect(classifyDatabase(41, true)).toBe("existing-workops");
    });

    it("refuses unknown non-empty schemas", () => {
        expect(classifyDatabase(3, false)).toBe("unknown-nonempty");
    });
});

describe("readDatabaseState", () => {
    it("counts tables and skips the migrations lookup when empty", async () => {
        const queries: string[] = [];
        const client = {
            $queryRawUnsafe: async <T>(sql: string): Promise<T> => {
                queries.push(sql);
                return [{ count: 0 }] as T;
            },
            $disconnect: async () => {},
        };
        const report = await readDatabaseState(client);
        expect(report).toEqual({ state: "empty", tableCount: 0 });
        expect(queries).toEqual([COUNT_PUBLIC_TABLES_SQL]);
    });

    it("detects _prisma_migrations on a non-empty database", async () => {
        const client = {
            $queryRawUnsafe: async <T>(sql: string): Promise<T> => {
                if (sql === COUNT_PUBLIC_TABLES_SQL) return [{ count: 40 }] as T;
                if (sql === HAS_MIGRATIONS_TABLE_SQL) return [{ count: 1 }] as T;
                throw new Error(`unexpected query: ${sql}`);
            },
            $disconnect: async () => {},
        };
        const report = await readDatabaseState(client);
        expect(report.state).toBe("existing-workops");
        expect(report.tableCount).toBe(40);
    });

    it("propagates connection errors to the caller", async () => {
        const client = {
            $queryRawUnsafe: async () => {
                throw new Error("ECONNREFUSED");
            },
            $disconnect: async () => {},
        };
        await expect(readDatabaseState(client)).rejects.toThrow("ECONNREFUSED");
    });
});
