import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertAcyclic, ReconciliationError } from "../../src/lib/users/reconciliation";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const USER_INVENTORY_SELECT = {
    id: true,
    email: true,
    name: true,
    role: true,
    isActive: true,
} as const;

type SelectedUser = {
    id: string;
    email: string;
    name: string;
    role: string;
    isActive: boolean;
};

export type UserInventoryState = {
    id: string;
    email: string;
    name: string;
    role?: string;
    isActive: boolean;
};

export type ReconciliationManifestMapping = {
    sourceUserId: string;
    canonicalUserId: string;
    approvedById: string;
    reason: string;
};

export type ReconciliationManifest = {
    inventoryChecksum: string;
    mappings: ReconciliationManifestMapping[];
    idempotencyKey: string;
};

export type CurrentStateProvider =
    | readonly UserInventoryState[]
    | (() => readonly UserInventoryState[] | Promise<readonly UserInventoryState[]>);

export type ApplyManifestOptions = {
    apply: boolean;
    expectedChecksum: string;
    currentState?: CurrentStateProvider;
};

export type ManifestPlanItem = ReconciliationManifestMapping & {
    action: "create" | "satisfied" | "conflict";
};

export type ApplyManifestResult = {
    status: "dry-run" | "applied" | "no-op";
    idempotencyKey: string;
    inventoryChecksum: string;
    created: number;
    existing: number;
    plan: ManifestPlanItem[];
};

export type ApplyCliOptions = {
    manifestPath: string;
    expectedChecksum?: string;
    apply: boolean;
};

type ExistingAlias = {
    sourceUserId: string;
    canonicalUserId: string;
    approvedById: string;
    reason: string;
};

type UserVerification = {
    id: string;
    isActive: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
    return value;
}

function requireChecksum(value: unknown, field: string): string {
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
        throw new Error(`${field} must be a lowercase SHA-256 checksum`);
    }
    return value;
}

export function parseManifest(value: unknown): ReconciliationManifest {
    if (!isRecord(value)) throw new Error("Manifest must be a JSON object");
    const inventoryChecksum = requireChecksum(value.inventoryChecksum, "inventoryChecksum");
    const idempotencyKey = requireNonEmptyString(value.idempotencyKey, "idempotencyKey");
    if (!Array.isArray(value.mappings)) throw new Error("mappings must be an array");

    const mappings = value.mappings.map((rawMapping, index) => {
        if (!isRecord(rawMapping)) throw new Error(`mappings[${index}] must be an object`);
        return {
            sourceUserId: requireNonEmptyString(rawMapping.sourceUserId, `mappings[${index}].sourceUserId`),
            canonicalUserId: requireNonEmptyString(rawMapping.canonicalUserId, `mappings[${index}].canonicalUserId`),
            approvedById: requireNonEmptyString(rawMapping.approvedById, `mappings[${index}].approvedById`),
            reason: requireNonEmptyString(rawMapping.reason, `mappings[${index}].reason`),
        } satisfies ReconciliationManifestMapping;
    });

    const sourceIds = new Set<string>();
    for (const mapping of mappings) {
        if (sourceIds.has(mapping.sourceUserId)) {
            throw new Error(`manifest contains duplicate sourceUserId ${mapping.sourceUserId}`);
        }
        sourceIds.add(mapping.sourceUserId);
    }

    return { inventoryChecksum, mappings, idempotencyKey };
}

export function computeInventoryChecksum(users: readonly UserInventoryState[]): string {
    const values = users.map((user) =>
        [
            user.id,
            user.email,
            user.name,
            user.role ?? "",
            user.isActive ? "true" : "false",
        ].join("\u0000"),
    );
    values.sort();
    return createHash("sha256").update(values.join("\n"), "utf8").digest("hex");
}

function toInventoryState(user: SelectedUser): UserInventoryState {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
    };
}

export async function loadCurrentState(db: PrismaClient, userIds: readonly string[]): Promise<UserInventoryState[]> {
    const ids = Array.from(new Set(userIds));
    if (ids.length === 0) return [];
    const users = await db.user.findMany({
        where: { id: { in: ids } },
        select: USER_INVENTORY_SELECT,
        orderBy: { id: "asc" },
    });
    return users.map(toInventoryState);
}

async function resolveCurrentState(
    db: PrismaClient,
    userIds: readonly string[],
    provider: CurrentStateProvider | undefined,
): Promise<UserInventoryState[]> {
    if (provider === undefined) return loadCurrentState(db, userIds);
    const state = typeof provider === "function" ? await provider() : provider;
    return state.map((user) => ({ ...user }));
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values));
}

function assertStateShape(state: readonly UserInventoryState[]): void {
    const ids = new Set<string>();
    for (const user of state) {
        if (!isRecord(user)) throw new ReconciliationError("current inventory state is invalid");
        if (typeof user.id !== "string" || user.id.length === 0 || ids.has(user.id)) {
            throw new ReconciliationError("current inventory state contains an invalid or duplicate user id");
        }
        if (typeof user.email !== "string" || typeof user.name !== "string" || typeof user.isActive !== "boolean") {
            throw new ReconciliationError("current inventory state is invalid");
        }
        if (user.role !== undefined && typeof user.role !== "string") {
            throw new ReconciliationError("current inventory state is invalid");
        }
        ids.add(user.id);
    }
}

function assertManifestSourcesAreSigned(
    manifest: ReconciliationManifest,
    signedState: readonly UserInventoryState[],
): void {
    const signedSourceIds = new Set(signedState.map((user) => user.id));
    for (const mapping of manifest.mappings) {
        if (!signedSourceIds.has(mapping.sourceUserId)) {
            throw new ReconciliationError(
                `mapping source ${mapping.sourceUserId} is not present in the signed inventory`,
            );
        }
    }
}

function assertChecksum(actual: string, expected: string, message: string): void {
    if (actual !== expected) throw new ReconciliationError(message);
}

function aliasMatches(mapping: ReconciliationManifestMapping, alias: ExistingAlias): boolean {
    return (
        alias.canonicalUserId === mapping.canonicalUserId &&
        alias.approvedById === mapping.approvedById &&
        alias.reason === mapping.reason
    );
}

function planFromAliases(
    mappings: readonly ReconciliationManifestMapping[],
    aliases: readonly ExistingAlias[],
): ManifestPlanItem[] {
    const aliasesBySource = new Map(aliases.map((alias) => [alias.sourceUserId, alias]));
    return mappings.map((mapping) => {
        const alias = aliasesBySource.get(mapping.sourceUserId);
        return {
            ...mapping,
            action: alias === undefined ? "create" : aliasMatches(mapping, alias) ? "satisfied" : "conflict",
        };
    });
}

async function readAliases(
    db: PrismaClient,
    sourceIds: readonly string[],
): Promise<ExistingAlias[]> {
    if (sourceIds.length === 0) return [];
    return db.userIdentityAlias.findMany({
        where: { sourceUserId: { in: [...sourceIds] } },
        select: { sourceUserId: true, canonicalUserId: true, approvedById: true, reason: true },
    });
}

function resultBase(
    manifest: ReconciliationManifest,
    checksum: string,
    status: ApplyManifestResult["status"],
    created: number,
    existing: number,
    plan: ManifestPlanItem[],
): ApplyManifestResult {
    return {
        status,
        idempotencyKey: manifest.idempotencyKey,
        inventoryChecksum: checksum,
        created,
        existing,
        plan,
    };
}

async function lockRows(
    tx: Prisma.TransactionClient,
    userIds: readonly string[],
    sourceIds: readonly string[],
): Promise<void> {
    if (userIds.length > 0) {
        await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "User"
            WHERE "id" IN (${Prisma.join([...userIds])})
            FOR UPDATE
        `;
    }
    if (sourceIds.length > 0) {
        await tx.$queryRaw<Array<{ sourceUserId: string }>>`
            SELECT "sourceUserId"
            FROM "UserIdentityAlias"
            WHERE "sourceUserId" IN (${Prisma.join([...sourceIds])})
            FOR UPDATE
        `;
    }
}

export async function applyManifest(
    db: PrismaClient,
    manifest: ReconciliationManifest,
    options: ApplyManifestOptions,
): Promise<ApplyManifestResult> {
    const parsedManifest = parseManifest(manifest);
    const expectedChecksum = requireChecksum(options.expectedChecksum, "expectedChecksum");
    if (parsedManifest.inventoryChecksum !== expectedChecksum) {
        throw new ReconciliationError("manifest inventory checksum does not match expected checksum");
    }

    const manifestSourceIds = unique(parsedManifest.mappings.map((mapping) => mapping.sourceUserId));
    const signedState = await resolveCurrentState(db, manifestSourceIds, options.currentState);
    assertStateShape(signedState);
    assertManifestSourcesAreSigned(parsedManifest, signedState);
    const signedChecksum = computeInventoryChecksum(signedState);
    assertChecksum(signedChecksum, expectedChecksum, "signed inventory checksum does not match expected checksum");

    const signedSourceIds = unique(signedState.map((user) => user.id));
    const liveState = await loadCurrentState(db, signedSourceIds);
    const liveChecksum = computeInventoryChecksum(liveState);
    assertChecksum(liveChecksum, expectedChecksum, "current inventory checksum does not match expected checksum");

    if (!options.apply) {
        const aliases = await readAliases(db, manifestSourceIds);
        const plan = planFromAliases(parsedManifest.mappings, aliases);
        const existing = plan.filter((item) => item.action === "satisfied").length;
        return resultBase(parsedManifest, expectedChecksum, "dry-run", 0, existing, plan);
    }

    const involvedUserIds = unique([
        ...signedSourceIds,
        ...parsedManifest.mappings.flatMap((mapping) => [
            mapping.sourceUserId,
            mapping.canonicalUserId,
            mapping.approvedById,
        ]),
    ]);

    return db.$transaction(async (tx) => {
        await lockRows(tx, involvedUserIds, manifestSourceIds);

        const lockedUsers = await tx.user.findMany({
            where: { id: { in: signedSourceIds } },
            select: USER_INVENTORY_SELECT,
        });
        const lockedState = lockedUsers.map(toInventoryState);
        assertChecksum(
            computeInventoryChecksum(lockedState),
            expectedChecksum,
            "current inventory checksum changed while applying manifest",
        );

        const verificationUsers = await tx.user.findMany({
            where: { id: { in: involvedUserIds } },
            select: { id: true, isActive: true },
        });
        const usersById = new Map<string, UserVerification>(verificationUsers.map((user) => [user.id, user]));
        const existingAliases = await tx.userIdentityAlias.findMany({
            where: { sourceUserId: { in: manifestSourceIds } },
            select: { sourceUserId: true, canonicalUserId: true, approvedById: true, reason: true },
        });
        const aliasesBySource = new Map(existingAliases.map((alias) => [alias.sourceUserId, alias]));
        const plan: ManifestPlanItem[] = [];
        const approvedAt = new Date();
        let created = 0;
        let existing = 0;

        for (const mapping of parsedManifest.mappings) {
            const sourceUser = usersById.get(mapping.sourceUserId);
            const canonicalUser = usersById.get(mapping.canonicalUserId);
            const approver = usersById.get(mapping.approvedById);
            if (!sourceUser || !canonicalUser || !sourceUser.isActive || !canonicalUser.isActive) {
                throw new ReconciliationError("source and canonical users must exist and be active");
            }
            if (!approver) throw new ReconciliationError("approver user does not exist");

            const existingAlias = aliasesBySource.get(mapping.sourceUserId);
            if (existingAlias) {
                if (!aliasMatches(mapping, existingAlias)) {
                    throw new ReconciliationError("existing alias conflicts with manifest");
                }
                existing += 1;
                plan.push({ ...mapping, action: "satisfied" });
                continue;
            }

            await assertAcyclic(tx, mapping.sourceUserId, mapping.canonicalUserId);
            await tx.userIdentityAlias.create({
                data: {
                    sourceUserId: mapping.sourceUserId,
                    canonicalUserId: mapping.canonicalUserId,
                    approvedById: mapping.approvedById,
                    approvedAt,
                    reason: mapping.reason,
                },
            });
            aliasesBySource.set(mapping.sourceUserId, {
                sourceUserId: mapping.sourceUserId,
                canonicalUserId: mapping.canonicalUserId,
                approvedById: mapping.approvedById,
                reason: mapping.reason,
            });
            created += 1;
            plan.push({ ...mapping, action: "create" });
        }

        return resultBase(
            parsedManifest,
            expectedChecksum,
            created === 0 ? "no-op" : "applied",
            created,
            existing,
            plan,
        );
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export function parseOptions(argv: readonly string[]): ApplyCliOptions {
    let manifestPath: string | undefined;
    let expectedChecksum: string | undefined;
    let apply = false;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--apply") {
            if (apply) throw new Error("--apply may only be supplied once");
            apply = true;
            continue;
        }
        if (argument === "--dry-run") {
            if (apply) throw new Error("--dry-run cannot be combined with --apply");
            continue;
        }
        if (argument === "--manifest") {
            const value = argv[index + 1];
            if (!value || value.startsWith("--")) throw new Error("--manifest requires a path");
            manifestPath = value;
            index += 1;
            continue;
        }
        if (argument.startsWith("--manifest=")) {
            const value = argument.slice("--manifest=".length);
            if (!value) throw new Error("--manifest requires a path");
            manifestPath = value;
            continue;
        }
        if (argument === "--expected-checksum") {
            const value = argv[index + 1];
            if (!value || value.startsWith("--")) throw new Error("--expected-checksum requires a value");
            expectedChecksum = value;
            index += 1;
            continue;
        }
        if (argument.startsWith("--expected-checksum=")) {
            const value = argument.slice("--expected-checksum=".length);
            if (!value) throw new Error("--expected-checksum requires a value");
            expectedChecksum = value;
            continue;
        }
        throw new Error(`Unknown option: ${argument}`);
    }

    if (!manifestPath) throw new Error("--manifest is required");
    if (apply && !expectedChecksum) throw new Error("--expected-checksum is required with --apply");
    return { manifestPath, expectedChecksum, apply };
}

export function loadManifest(manifestPath: string): ReconciliationManifest {
    const absolutePath = resolve(manifestPath);
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
    } catch {
        throw new Error("manifest could not be resolved");
    }
    return parseManifest(parsed);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
    const options = parseOptions(argv);
    const manifest = loadManifest(options.manifestPath);
    const db = new PrismaClient();
    try {
        const sourceIds = unique(manifest.mappings.map((mapping) => mapping.sourceUserId));
        const currentState = await loadCurrentState(db, sourceIds);
        const expectedChecksum = options.expectedChecksum ?? manifest.inventoryChecksum;
        const result = await applyManifest(db, manifest, {
            apply: options.apply,
            expectedChecksum,
            currentState,
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
        await db.$disconnect();
    }
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
    void main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : "Reconciliation failed"}\n`);
        process.exitCode = 1;
    });
}
