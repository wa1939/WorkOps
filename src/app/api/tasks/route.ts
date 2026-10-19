import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { createTask, listTasksForActor, TaskCommandError } from "@/lib/tasks/commands";
import { createTaskSchema } from "@/lib/tasks/schemas";
export const dynamic = "force-dynamic";
const actor = (u: any) => ({ id: u.id, role: u.role ?? "MEMBER" });
function errorResponse(error: unknown, fallback: string) { if (error instanceof TaskCommandError) return NextResponse.json({ error: error.message }, { status: error.status }); if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors }, { status: 400 }); console.error(fallback, error); return NextResponse.json({ error: fallback }, { status: 500 }); }
export async function GET(request: Request) { try { const session = await auth(); if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const p = new URL(request.url).searchParams; const split = (key: string) => p.get(key)?.split(",").filter(Boolean); const due = p.get("due") ?? undefined; const tasks = await listTasksForActor({ status: split("status"), priority: split("priority"), assigneeId: p.get("assigneeId") ?? undefined, projectId: p.get("projectId") ?? undefined, caseStudyId: p.get("caseStudyId") ?? undefined, floating: p.get("floating") ?? undefined, due, search: p.get("search") ?? undefined, limit: 100 }, actor(session.user), prisma); return NextResponse.json(tasks); } catch (e) { return errorResponse(e, "Failed to fetch tasks"); } }
export async function POST(request: Request) { try { const session = await auth(); if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const data = createTaskSchema.parse(await request.json()); return NextResponse.json(await createTask(data, actor(session.user), prisma), { status: 201 }); } catch (e) { return errorResponse(e, "Failed to create task"); } }
