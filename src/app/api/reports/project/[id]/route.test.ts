import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../../../scripts/assert-local-database";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { GET } from "./route";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Project report tests require a dedicated _test database");
    }
    process.env.DATABASE_URL = databaseUrl;
}

const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();
const authMock = vi.mocked(auth);

type Fixture = { ownerId: string; outsiderId: string; projectId: string };

async function createFixture(): Promise<Fixture> {
    const suffix = randomUUID();
    const owner = await db.user.create({ data: { email: `project-report-owner-${suffix}@example.test`, name: "Report Owner", role: "MEMBER" } });
    const outsider = await db.user.create({ data: { email: `project-report-outsider-${suffix}@example.test`, name: "Report Outsider", role: "MEMBER" } });
    const project = await db.project.create({ data: { name: `Project Report ${suffix}`, ownerId: owner.id } });
    return { ownerId: owner.id, outsiderId: outsider.id, projectId: project.id };
}

async function destroyFixture(fixture: Fixture): Promise<void> {
    await db.project.delete({ where: { id: fixture.projectId } });
    await db.user.deleteMany({ where: { id: { in: [fixture.ownerId, fixture.outsiderId] } } });
}

afterEach(() => authMock.mockReset());
afterAll(async () => db.$disconnect());

describe.runIf(databaseEnabled)("GET /api/reports/project/[id]", () => {
    it("returns 404 to a non-member instead of leaking the project report", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.outsiderId, role: "MEMBER" } } as never);
        try {
            const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: fixture.projectId }) });
            expect(response.status).toBe(404);
        } finally {
            await destroyFixture(fixture);
        }
    });
});
