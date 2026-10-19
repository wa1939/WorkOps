import { PrismaClient } from "@prisma/client";
import type { APIRequestContext } from "@playwright/test";

export const PMO_PASSWORD = "TestPass123!";
export const PMO_EMAILS = {
    admin: "e2e-pmo-admin@test.com",
    manager: "e2e-pmo-manager@test.com",
    owner: "e2e-pmo-owner@test.com",
    parentOwner: "e2e-pmo-parent-owner@test.com",
    member: "e2e-pmo-member@test.com",
    viewer: "e2e-pmo-viewer@test.com",
    inactive: "e2e-pmo-inactive@test.com",
} as const;
export type PmoRole = keyof typeof PMO_EMAILS;

export const PMO_IDS = {
    workArea: "e2e-pmo-area",
    project: "e2e-pmo-project",
    caseStudy: "e2e-pmo-case",
    contact: "e2e-pmo-contact",
    department: "e2e-pmo-department",
} as const;

export function pmoName(scenario: string): string {
    const name = `e2e-pmo-${scenario}`;
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Unsafe PMO fixture name: ${name}`);
    return name;
}

export async function getPmoUser(request: APIRequestContext, role: PmoRole) {
    const response = await request.get("/api/users");
    if (!response.ok()) throw new Error(`Unable to load users: ${response.status()}`);
    const users = await response.json() as Array<{ id: string; email: string; name: string }>;
    const user = users.find(({ email }) => email === PMO_EMAILS[role]);
    if (!user) throw new Error(`Missing PMO fixture user: ${role}`);
    return user;
}

export async function createPmoAction(
    request: APIRequestContext,
    scenario: string,
    options: {
        parent?: "project" | "caseStudy";
        ownerId?: string;
        externalContactId?: string;
        dueDate?: string;
        title?: string;
    } = {},
) {
    const owner = options.ownerId ? { id: options.ownerId } : await getPmoUser(request, "owner");
    const parent = options.parent ?? "project";
    const response = await request.post("/api/pmo/actions", {
        data: {
            title: options.title ?? pmoName(scenario),
            description: `Requested action for ${pmoName(scenario)}`,
            ownerId: owner.id,
            externalContactId: options.externalContactId ?? PMO_IDS.contact,
            dueDate: options.dueDate ?? "2026-12-31",
            projectId: parent === "project" ? PMO_IDS.project : null,
            caseStudyId: parent === "caseStudy" ? PMO_IDS.caseStudy : null,
        },
    });
    if (response.status() !== 201) throw new Error(`Create PMO action failed (${response.status()}): ${await response.text()}`);
    return await response.json() as { taskId: string; externalActionId: string };
}

export async function withPmoPrisma<T>(callback: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    const prisma = new PrismaClient();
    try {
        return await callback(prisma);
    } finally {
        await prisma.$disconnect();
    }
}
