import type { Prisma, PrismaClient } from "@prisma/client";

export class ReconciliationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ReconciliationError";
    }
}

export type CanonicalMapping = {
    sourceUserId: string;
    canonicalUserId: string;
    approvedById?: string;
    approvedAt?: Date;
    reason?: string;
};

type AliasDatabase = Pick<Prisma.TransactionClient, "userIdentityAlias">;
export type ReconciliationDatabase = Pick<PrismaClient, "user" | "userIdentityAlias" | "$transaction">;

export function requestCanonicalMapping(
    input: {
        sourceUserId?: string;
        canonicalUserId?: string;
        approvedById?: string;
        reason?: string;
    },
    nameHints?: { sourceName?: string; canonicalName?: string },
): CanonicalMapping {
    void nameHints;
    if (typeof input.sourceUserId !== "string" || input.sourceUserId.length === 0) {
        throw new TypeError("sourceUserId is required; identity cannot be inferred from names");
    }
    if (typeof input.canonicalUserId !== "string" || input.canonicalUserId.length === 0) {
        throw new TypeError("canonicalUserId is required; identity cannot be inferred from names");
    }

    const mapping: CanonicalMapping = {
        sourceUserId: input.sourceUserId,
        canonicalUserId: input.canonicalUserId,
    };
    if (input.approvedById !== undefined) mapping.approvedById = input.approvedById;
    if (input.reason !== undefined) mapping.reason = input.reason;
    return mapping;
}

export async function assertAcyclic(
    db: AliasDatabase,
    sourceUserId: string,
    canonicalUserId: string,
): Promise<void> {
    if (sourceUserId === canonicalUserId) {
        throw new ReconciliationError("cyclic alias");
    }

    const visited = new Set<string>();
    let currentUserId = canonicalUserId;
    while (!visited.has(currentUserId)) {
        if (currentUserId === sourceUserId) {
            throw new ReconciliationError("cyclic alias");
        }
        visited.add(currentUserId);
        const next = await db.userIdentityAlias.findUnique({
            where: { sourceUserId: currentUserId },
            select: { canonicalUserId: true },
        });
        if (!next) return;
        currentUserId = next.canonicalUserId;
    }

    throw new ReconciliationError("cyclic alias");
}

export async function applyMapping(
    db: ReconciliationDatabase,
    mapping: CanonicalMapping,
) {
    const approvedById = mapping.approvedById;
    const reason = mapping.reason;
    if (typeof approvedById !== "string" || approvedById.length === 0) {
        throw new TypeError("approvedById is required to apply a mapping");
    }
    if (typeof reason !== "string") {
        throw new TypeError("reason is required to apply a mapping");
    }

    return db.$transaction(async (tx) => {
        await assertAcyclic(tx, mapping.sourceUserId, mapping.canonicalUserId);

        const [sourceUser, canonicalUser, approvedBy] = await Promise.all([
            tx.user.findUnique({
                where: { id: mapping.sourceUserId },
                select: { id: true, isActive: true },
            }),
            tx.user.findUnique({
                where: { id: mapping.canonicalUserId },
                select: { id: true, isActive: true },
            }),
            tx.user.findUnique({
                where: { id: approvedById },
                select: { id: true },
            }),
        ]);

        if (!sourceUser || !canonicalUser || !sourceUser.isActive || !canonicalUser.isActive) {
            throw new ReconciliationError("source and canonical users must exist and be active");
        }
        if (!approvedBy) {
            throw new ReconciliationError("approver user does not exist");
        }

        return tx.userIdentityAlias.create({
            data: {
                sourceUserId: mapping.sourceUserId,
                canonicalUserId: mapping.canonicalUserId,
                approvedById,
                approvedAt: mapping.approvedAt ?? new Date(),
                reason,
            },
        });
    });
}

export function canonicalizeMemberships(
    membershipLists: Array<Array<{ taskId: string; userId: string }>>,
    resolveCanonical: (userId: string) => string,
): Array<{ taskId: string; userId: string }> {
    const seenByTask = new Map<string, Set<string>>();
    const canonicalMemberships: Array<{ taskId: string; userId: string }> = [];

    for (const memberships of membershipLists) {
        for (const membership of memberships) {
            const canonicalUserId = resolveCanonical(membership.userId);
            const taskUsers = seenByTask.get(membership.taskId) ?? new Set<string>();
            if (taskUsers.has(canonicalUserId)) continue;
            taskUsers.add(canonicalUserId);
            seenByTask.set(membership.taskId, taskUsers);
            canonicalMemberships.push({ taskId: membership.taskId, userId: canonicalUserId });
        }
    }

    return canonicalMemberships;
}

export function auditActorOf(originalUserId: string, mappings: Map<string, string>): string {
    void mappings;
    return originalUserId;
}
