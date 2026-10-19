// Core first-admin bootstrap. Only allowed while the User table is empty
// (fresh installs); refuses to create or modify anything when users exist.
// Password material never appears in logs or errors.

import { validateAdminInput, type AdminInput } from "./admin-validation";

export class AdminRefused extends Error {
    readonly reason: "users-exist" | "invalid-input";
    constructor(reason: "users-exist" | "invalid-input", message: string) {
        super(message);
        this.name = "AdminRefused";
        this.reason = reason;
    }
}

export type AdminClient = {
    user: {
        count(): Promise<number>;
        create(args: {
            data: {
                email: string;
                name: string;
                password: string;
                role: "ADMIN";
                isActive: boolean;
                emailVerified: Date;
            };
        }): Promise<{ id: string; email: string }>;
    };
    workspace: {
        create(args: { data: { name: string; slug: string; timezone: string } }): Promise<{ id: string }>;
    };
    workspaceMember: {
        create(args: { data: { workspaceId: string; userId: string; role: "OWNER"; active: boolean } }): Promise<unknown>;
    };
    $disconnect?(): Promise<void>;
};

export type CreateFirstAdminDeps = {
    client: AdminClient;
    input: Partial<AdminInput>;
    /** e.g. bcryptjs hash with cost 12. */
    hashPassword: (password: string) => Promise<string>;
    log: (line: string) => void;
};

export type CreatedAdmin = { id: string; email: string };

export async function createFirstAdmin(
    deps: CreateFirstAdminDeps,
): Promise<CreatedAdmin> {
    const validation = validateAdminInput(deps.input);
    if (!validation.ok) {
        throw new AdminRefused(
            "invalid-input",
            "Invalid admin input:\n  - " + validation.errors.join("\n  - "),
        );
    }

    const userCount = await deps.client.user.count();
    if (userCount > 0) {
        throw new AdminRefused(
            "users-exist",
            `Refusing to create an admin: the User table already has ${userCount} user(s). ` +
                "Bootstrap is only allowed on a fresh install. Manage users from the app " +
                "(Settings > team) instead. Nothing was written.",
        );
    }

    const passwordHash = await deps.hashPassword(validation.normalized.password);
    const created = await deps.client.user.create({
        data: {
            email: validation.normalized.email,
            name: validation.normalized.name,
            password: passwordHash,
            role: "ADMIN",
            isActive: true,
            emailVerified: new Date(),
        },
    });

    const workspace = await deps.client.workspace.create({
        data: { name: "WorkOps", slug: "workops", timezone: "UTC" },
    });
    await deps.client.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: created.id, role: "OWNER", active: true },
    });

    deps.log(`Created first admin: ${created.email} (role ADMIN, id ${created.id}).`);
    deps.log("Created the WorkOps workspace with an active OWNER membership.");
    deps.log("The password is not displayed. Sign in at /login with this email.");
    return { id: created.id, email: created.email };
}
