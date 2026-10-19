import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import {
    createProject,
    listProjectsForActor,
    ProjectCommandError,
} from "@/lib/projects/commands";
import { createProjectSchema } from "@/lib/projects/schemas";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const actor = await toSabahActor(session.user);
        const projects = await listProjectsForActor({}, actor);
        return NextResponse.json(projects);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        console.error("GET /api/projects error:", error);
        return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const actor = await toSabahActor(session.user);
        const body = await request.json();
        const input = createProjectSchema.parse(body);
        // Legacy floating semantics: makeFloating explicitly requests an
        // ownerless project. Zod strips the flag, so read it from the raw body.
        const makeFloating = z.boolean().optional().parse(body?.makeFloating);
        const project = await createProject(
            makeFloating === true ? { ...input, ownerId: null } : input,
            actor,
        );
        return NextResponse.json(project, { status: 201 });
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
        console.error("POST /api/projects error:", error);
        return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
    }
}
