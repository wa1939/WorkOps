import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { getProjectForActor, updateProject, ProjectCommandError } from "@/lib/projects/commands";
import { updateProjectSchema } from "@/lib/projects/schemas";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";

const versionedUpdateSchema = z
    .object({
        expectedUpdatedAt: z.string().datetime(),
    })
    .and(updateProjectSchema);

const timelineDatePatchSchema = z
    .object({
        startAt: z.string().datetime().nullish(),
        dueAt: z.string().datetime().nullish(),
        dueAtEnd: z.string().datetime().nullish(),
    })
    .partial()
    .strict();

const versionedTimelinePatchSchema = z
    .object({
        expectedUpdatedAt: z.string().datetime(),
        dates: timelineDatePatchSchema,
    })
    .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseVersionedProjectPatch(body: unknown) {
    if (isRecord(body) && "dates" in body) {
        const parsed = versionedTimelinePatchSchema.parse(body);
        return { expectedUpdatedAt: parsed.expectedUpdatedAt, input: parsed.dates };
    }
    const { expectedUpdatedAt, ...input } = versionedUpdateSchema.parse(body);
    return { expectedUpdatedAt, input };
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { id } = await params;
        const actor = await toSabahActor(session.user);
        const project = await getProjectForActor(id, actor);
        if (!project) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }
        return NextResponse.json(project);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        console.error("GET /api/projects/[id] error:", error);
        return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { id } = await params;
        const actor = await toSabahActor(session.user);
        const body = await request.json();
        const { expectedUpdatedAt, input } = parseVersionedProjectPatch(body);
        const project = await updateProject(id, input, actor, new Date(expectedUpdatedAt));
        return NextResponse.json(project);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        const status = (error as { status?: number })?.status;
        if (error instanceof ProjectCommandError || (typeof status === "number" && status >= 400 && status < 500)) {
            const commandError = error as { message: string; status: number; code?: string };
            return NextResponse.json(
                { error: commandError.message, code: commandError.code ?? "COMMAND_ERROR" },
                { status: commandError.status },
            );
        }
        console.error("PATCH /api/projects/[id] error:", error);
        return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;

        await prisma.$transaction(async (tx) => {
            // Re-read the actor and serialize the parent row in the same
            // transaction as the authorization and PMO guard. PostgreSQL's
            // FK KEY SHARE lock for a concurrent Task insert conflicts with
            // this FOR UPDATE lock, so creation cannot slip between the
            // check and the parent delete.
            const actor = await toSabahActor(session.user, tx);
            await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${id} FOR UPDATE`;
            const existing = await tx.project.findUnique({ where: { id }, select: { ownerId: true } });
            if (!existing) {
                throw new ProjectCommandError("Project not found", 404, "NOT_FOUND");
            }
            if (existing.ownerId !== actor.id && actor.role !== "ADMIN") {
                throw new ProjectCommandError("Forbidden", 403, "FORBIDDEN");
            }
            const pmoAction = await tx.task.findFirst({
                where: { projectId: id, type: "EXTERNAL_ACTION" },
                select: { id: true },
            });
            if (pmoAction) {
                throw new ProjectCommandError(
                    "This project cannot be deleted while PMO actions reference it; retain their history.",
                    409,
                    "PMO_ACTIONS_EXIST",
                );
            }
            await tx.project.delete({ where: { id } });
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (error instanceof ProjectCommandError) {
            return NextResponse.json(
                { error: error.message, code: error.code },
                { status: error.status },
            );
        }
        console.error("DELETE /api/projects/[id] error:", error);
        return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
    }
}
