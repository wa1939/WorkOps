import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../../../../scripts/assert-local-database";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    assertLocalDatabaseUrl(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));

import { PATCH } from "./route";

describe.runIf(databaseEnabled)("PATCH /api/tasks/[id]/subtasks/reorder", () => {
    it("forbids a non-member from reordering a parent's subtasks", async () => {
        const prisma = new PrismaClient();
        const suffix = randomUUID();
        const ownerId = `t17-owner-${suffix}`;
        const outsiderId = `t17-outsider-${suffix}`;
        const projectId = `t17-project-${suffix}`;
        const parentId = `t17-parent-${suffix}`;
        const childId = `t17-child-${suffix}`;

        try {
            await prisma.user.createMany({
                data: [
                    { id: ownerId, email: `${ownerId}@example.test`, name: "T17 Owner", role: "MEMBER" },
                    { id: outsiderId, email: `${outsiderId}@example.test`, name: "T17 Outsider", role: "MEMBER" },
                ],
            });
            await prisma.project.create({ data: { id: projectId, name: "T17 Project", ownerId } });
            await prisma.projectMember.create({ data: { projectId, userId: ownerId, accessLevel: "ADMIN" } });
            await prisma.task.createMany({
                data: [
                    { id: parentId, title: "T17 parent", projectId, createdById: ownerId },
                    { id: childId, title: "T17 child", projectId, parentTaskId: parentId, createdById: ownerId },
                ],
            });
            auth.mockResolvedValue({ user: { id: outsiderId, role: "MEMBER" } });

            const response = await PATCH(
                new Request(`http://localhost/api/tasks/${parentId}/subtasks/reorder`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ orderedIds: [childId] }),
                }),
                { params: Promise.resolve({ id: parentId }) },
            );

            expect(response.status).toBe(403);
        } finally {
            await prisma.task.deleteMany({ where: { id: { in: [parentId, childId] } } });
            await prisma.projectMember.deleteMany({ where: { projectId } });
            await prisma.project.deleteMany({ where: { id: projectId } });
            await prisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } });
            await prisma.$disconnect();
            auth.mockReset();
        }
    });
});
