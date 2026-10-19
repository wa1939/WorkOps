import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl } from "../assert-local-database";
import { parseOptions, runInspection } from "./inspect-duplicates";

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseEnabled = Boolean(databaseUrl);
if (databaseEnabled) assertLocalDatabaseUrl(databaseUrl);

type Fixture = {
    userId: string;
    email: string;
    passwordHash: string;
    departmentId: string;
    userDepartmentId: string;
    taskId: string;
    assignmentId: string;
    sessionId: string;
    accountId: string;
};

async function createFixture(db: PrismaClient): Promise<Fixture> {
    const suffix = randomUUID();
    const ids = {
        userId: `i01-user-${suffix}`,
        email: `i01-${suffix}@example.test`,
        departmentId: `i01-department-${suffix}`,
        userDepartmentId: `i01-user-department-${suffix}`,
        taskId: `i01-task-${suffix}`,
        assignmentId: `i01-assignment-${suffix}`,
        sessionId: `i01-session-${suffix}`,
        accountId: `i01-account-${suffix}`,
    };
    const passwordHash = await bcrypt.hash(`i01-password-${suffix}`, 4);

    await db.user.create({
        data: {
            id: ids.userId,
            email: ids.email,
            name: `I01 synthetic ${suffix}`,
            password: passwordHash,
            role: "MEMBER",
            isActive: true,
        },
    });
    await db.department.create({ data: { id: ids.departmentId, name: ids.departmentId } });
    await db.userDepartment.create({
        data: { id: ids.userDepartmentId, userId: ids.userId, departmentId: ids.departmentId },
    });
    await db.task.create({ data: { id: ids.taskId, title: `I01 task ${suffix}`, createdById: ids.userId } });
    await db.taskAssignment.create({ data: { id: ids.assignmentId, taskId: ids.taskId, userId: ids.userId } });
    await db.session.create({
        data: {
            id: ids.sessionId,
            sessionToken: `i01-session-token-${suffix}`,
            userId: ids.userId,
            expires: new Date("2099-01-01T00:00:00.000Z"),
        },
    });
    await db.account.create({
        data: {
            id: ids.accountId,
            userId: ids.userId,
            type: "oauth",
            provider: `i01-provider-${suffix}`,
            providerAccountId: `i01-provider-account-${suffix}`,
        },
    });

    return { ...ids, passwordHash };
}

async function cleanupFixture(db: PrismaClient, fixture: Fixture): Promise<void> {
    await db.account.deleteMany({ where: { id: fixture.accountId } });
    await db.session.deleteMany({ where: { id: fixture.sessionId } });
    await db.taskAssignment.deleteMany({ where: { id: fixture.assignmentId } });
    await db.task.deleteMany({ where: { id: fixture.taskId } });
    await db.userDepartment.deleteMany({ where: { id: fixture.userDepartmentId } });
    await db.department.deleteMany({ where: { id: fixture.departmentId } });
    await db.user.deleteMany({ where: { id: fixture.userId } });
}

async function withFixture(testBody: (db: PrismaClient, fixture: Fixture) => Promise<void>): Promise<void> {
    const db = new PrismaClient();
    const fixture = await createFixture(db);
    try {
        await testBody(db, fixture);
    } finally {
        await cleanupFixture(db, fixture);
        await db.$disconnect();
    }
}

describe.runIf(databaseEnabled)("inspect-duplicates", () => {
    it("defaults to dry run", async () => {
        await withFixture(async (db, fixture) => {
            const before = await Promise.all([
                db.user.findUnique({
                    where: { id: fixture.userId },
                    select: { id: true, email: true, name: true, role: true, isActive: true },
                }),
                db.userDepartment.count({ where: { id: fixture.userDepartmentId } }),
                db.task.count({ where: { id: fixture.taskId } }),
                db.taskAssignment.count({ where: { id: fixture.assignmentId } }),
                db.session.count({ where: { id: fixture.sessionId } }),
                db.account.count({ where: { id: fixture.accountId } }),
            ]);

            const report = await runInspection(parseOptions(["--email", fixture.email]), db);

            const after = await Promise.all([
                db.user.findUnique({
                    where: { id: fixture.userId },
                    select: { id: true, email: true, name: true, role: true, isActive: true },
                }),
                db.userDepartment.count({ where: { id: fixture.userDepartmentId } }),
                db.task.count({ where: { id: fixture.taskId } }),
                db.taskAssignment.count({ where: { id: fixture.assignmentId } }),
                db.session.count({ where: { id: fixture.sessionId } }),
                db.account.count({ where: { id: fixture.accountId } }),
            ]);

            expect(report.mode).toBe("dry-run");
            expect(after).toEqual(before);
        });
    });

    it("does not expose credentials", async () => {
        await withFixture(async (db, fixture) => {
            const report = await runInspection(parseOptions(["--email", fixture.email]), db);
            const serialized = JSON.stringify(report);

            expect(serialized).not.toContain(fixture.passwordHash);
            expect(serialized).not.toMatch(/"password(?:Hash)?"/i);
            expect(serialized).not.toMatch(/"secret"/i);
            expect(serialized).not.toMatch(/"token"/i);
        });
    });

    it("lists every user foreign key before merge", async () => {
        await withFixture(async (db, fixture) => {
            const report = await runInspection(parseOptions(["--email", fixture.email]), db);
            const inventoryKeys = new Set(
                report.foreignKeyInventory.map((entry) => `${entry.table}.${entry.column}`),
            );
            const exercisedForeignKeys = [
                "UserDepartment.userId",
                "TaskAssignment.userId",
                "Task.createdById",
                "Session.userId",
                "Account.userId",
            ];

            expect(report.foreignKeyInventory.length).toBeGreaterThanOrEqual(exercisedForeignKeys.length);
            for (const key of exercisedForeignKeys) expect(inventoryKeys.has(key)).toBe(true);

            const userReport = report.users.find((entry) => entry.user?.id === fixture.userId);
            expect(userReport).toBeDefined();
            for (const key of exercisedForeignKeys) {
                const [table, column] = key.split(".");
                expect(userReport?.references).toContainEqual(expect.objectContaining({ table, column, count: 1 }));
            }
        });
    });
});
