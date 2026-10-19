import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const SABAH_ROLES = ["ADMIN", "LEAD", "MEMBER", "VIEWER"] as const;
type SabahRole = (typeof SABAH_ROLES)[number];
type SabahSessionUser = { id?: string | null; role?: string | null };
type ActorDatabase = Pick<PrismaClient, "user">;

export class SabahForbiddenError extends Error {
    public readonly status = 403;
    public readonly code = "SABAH_FORBIDDEN";

    constructor() {
        super("Forbidden");
        this.name = "SabahForbiddenError";
    }
}

function isSabahRole(role: string | null | undefined): role is SabahRole {
    return typeof role === "string" && (SABAH_ROLES as readonly string[]).includes(role);
}

// The persisted Role enum uses MANAGER; Sabah's internal contracts use LEAD.
function normalizeRole(role: string | null | undefined): SabahRole | null {
    const mapped = role === "MANAGER" ? "LEAD" : role;
    return isSabahRole(mapped) ? mapped : null;
}

export async function toSabahActor(
    sessionUser: SabahSessionUser | null | undefined,
    db: ActorDatabase = prisma,
): Promise<{
    id: string;
    role: SabahRole;
    departmentIds: string[];
}> {
    if (!sessionUser?.id) {
        throw new SabahForbiddenError();
    }

    const user = await db.user.findUnique({
        where: { id: sessionUser.id },
        select: {
            id: true,
            role: true,
            isActive: true,
            departments: {
                select: { departmentId: true },
            },
        },
    });

    if (!user?.isActive) {
        throw new SabahForbiddenError();
    }

    // Authorization follows the persisted role, never the session JWT, so
    // demotions apply immediately instead of at token expiry.
    const role = normalizeRole(user.role);
    if (!role) {
        throw new SabahForbiddenError();
    }

    return {
        id: user.id,
        role,
        departmentIds: Array.from(new Set(user.departments.map(({ departmentId }) => departmentId))),
    };
}

export type SabahActor = Awaited<ReturnType<typeof toSabahActor>>;
