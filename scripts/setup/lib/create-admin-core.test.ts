import { describe, expect, it } from "vitest";
import { AdminRefused, createFirstAdmin, type AdminClient } from "./create-admin-core";

function makeClient(userCount: number) {
    const created: Array<Record<string, unknown>> = [];
    const memberships: Array<Record<string, unknown>> = [];
    const client: Pick<AdminClient, "user" | "$disconnect"> & { created: Array<Record<string, unknown>> } = {
        user: {
            count: async () => userCount,
            create: async (args) => {
                created.push(args.data as Record<string, unknown>);
                return { id: "admin-1", email: args.data.email };
            },
        },
        $disconnect: async () => {},
        created,
    };
    return Object.assign(client, {
        workspace: { create: async () => ({ id: "workspace-1" }) },
        workspaceMember: { create: async (args: { data: Record<string, unknown> }) => { memberships.push(args.data); return args.data; } },
        memberships,
    });
}

const input = { email: "Owner@Example.com", name: "Owner", password: "correct horse 42" };
const okDeps = {
    input,
    hashPassword: async (password: string) => `hashed(${password.length})`,
    log: () => {},
};

describe("createFirstAdmin", () => {
    it("creates an active verified ADMIN on an empty user table and never logs the password", async () => {
        const client = makeClient(0);
        const lines: string[] = [];
        const result = await createFirstAdmin({
            ...okDeps,
            client,
            log: (line) => lines.push(line),
        });
        expect(result.email).toBe("owner@example.com");
        expect(client.created).toHaveLength(1);
        const data = client.created[0] as Record<string, unknown>;
        expect(data.role).toBe("ADMIN");
        expect(data.isActive).toBe(true);
        expect(data.emailVerified).toBeInstanceOf(Date);
        expect(data.password).toBe("hashed(16)");
        expect(client.memberships).toEqual([{ workspaceId: "workspace-1", userId: "admin-1", role: "OWNER", active: true }]);
        expect(lines.join("\n")).not.toContain("correct horse");
        expect(lines.join("\n")).not.toContain("hashed(");
    });

    it("refuses when any user already exists", async () => {
        const client = makeClient(3);
        await expect(
            createFirstAdmin({ ...okDeps, client }),
        ).rejects.toMatchObject({ name: "AdminRefused", reason: "users-exist" });
        expect(client.created).toHaveLength(0);
    });

    it("refuses invalid input before any database call", async () => {
        const client = makeClient(0);
        await expect(
            createFirstAdmin({ ...okDeps, client, input: { ...input, password: "short" } }),
        ).rejects.toMatchObject({ reason: "invalid-input" });
        expect(client.created).toHaveLength(0);
    });
});
