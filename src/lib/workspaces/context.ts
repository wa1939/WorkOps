import type { PrismaClient, WorkspaceRole } from "@prisma/client";

export type WorkspaceDatabase = Pick<PrismaClient, "workspaceMember">;

export type WorkspaceContext = {
    userId: string;
    workspaceId: string;
    workspace: {
        id: string;
        slug: string;
        name: string;
        timezone: string;
        archivedAt: Date | null;
    };
    role: WorkspaceRole;
    membershipActive: boolean;
    canWrite: boolean;
};

export class WorkspaceContextError extends Error {
    constructor(message: string, public readonly status: number, public readonly code: string) {
        super(message);
        this.name = "WorkspaceContextError";
    }
}

const WRITABLE_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER"];

function workspaceNotFound(): WorkspaceContextError {
    return new WorkspaceContextError("Workspace not found", 404, "WORKSPACE_NOT_FOUND");
}

async function readMembership(
    db: WorkspaceDatabase,
    userId: string,
    workspaceId: string,
) {
    return db.workspaceMember.findUnique({
        where: {
            workspaceId_userId: { workspaceId, userId },
        },
        select: {
            role: true,
            active: true,
            workspace: {
                select: {
                    id: true,
                    slug: true,
                    name: true,
                    timezone: true,
                    archivedAt: true,
                },
            },
        },
    });
}

export async function resolveWorkspaceContext(
    db: WorkspaceDatabase,
    userId: string,
    requestedWorkspaceId: string | null | undefined,
): Promise<WorkspaceContext> {
    let workspaceId = requestedWorkspaceId;

    if (workspaceId == null) {
        const activeMemberships = await db.workspaceMember.findMany({
            where: { userId, active: true },
            select: { workspaceId: true },
        });

        if (activeMemberships.length === 0) {
            throw new WorkspaceContextError("No workspace membership", 404, "NO_WORKSPACE");
        }
        if (activeMemberships.length > 1) {
            throw new WorkspaceContextError(
                "Workspace selection is required",
                409,
                "WORKSPACE_SELECTION_REQUIRED",
            );
        }

        workspaceId = activeMemberships[0].workspaceId;
    }

    const membership = await readMembership(db, userId, workspaceId);
    if (!membership) {
        throw workspaceNotFound();
    }
    if (!membership.active) {
        throw new WorkspaceContextError(
            "Workspace membership is inactive",
            403,
            "MEMBERSHIP_INACTIVE",
        );
    }

    const workspace = membership.workspace;
    const canWrite =
        membership.active &&
        WRITABLE_ROLES.includes(membership.role) &&
        workspace.archivedAt === null;

    return {
        userId,
        workspaceId: workspace.id,
        workspace,
        role: membership.role,
        membershipActive: membership.active,
        canWrite,
    };
}

export function assertWritable(context: WorkspaceContext): void {
    if (!context.canWrite) {
        throw new WorkspaceContextError(
            "Archived workspace rejects writes",
            403,
            "WORKSPACE_ARCHIVED",
        );
    }
}
