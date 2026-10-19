import type { PrismaClient, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PmoActor } from "./authorization";

type ActorDatabase = Pick<PrismaClient, "user">;

export class PmoAuthenticationError extends Error {
    constructor() {
        super("Unauthorized");
        this.name = "PmoAuthenticationError";
    }
}

export async function resolvePmoActor(
    userId: string | undefined,
    db: ActorDatabase = prisma,
): Promise<PmoActor> {
    if (!userId) throw new PmoAuthenticationError();

    const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true },
    });
    if (!user?.isActive) throw new PmoAuthenticationError();

    return { id: user.id, role: user.role as Role };
}
