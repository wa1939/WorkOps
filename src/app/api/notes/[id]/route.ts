import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getNoteForActor, updateNote, NoteCommandError } from "@/lib/notes/commands";
import { z } from "zod";
const actor = (u: any) => ({ id: u.id, role: u.role, departmentIds: u.departmentIds ?? [] });
const legacy = z.object({ title: z.string().min(1).optional(), body: z.string().optional(), isShared: z.boolean().optional(), isPinned: z.boolean().optional(), color: z.string().optional(), tagIds: z.array(z.string()).optional(), links: z.array(z.object({ label: z.string().min(1), url: z.string().url() })).optional(), taskId: z.string().nullable().optional(), caseStudyId: z.string().nullable().optional(), expectedUpdatedAt: z.string().datetime() });
function failure(error: any, fallback: string) { if (error instanceof NoteCommandError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status }); console.error(fallback, error); return NextResponse.json({ error: fallback }, { status: 500 }); }
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try { const session = await auth(); if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); return NextResponse.json(await getNoteForActor(params.id, actor(session.user))); } catch (e) { return failure(e, "Failed to fetch note"); }
}
export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try { const session = await auth(); if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const parsed = legacy.parse(await request.json()); const note = await updateNote(params.id, parsed, actor(session.user)); return NextResponse.json(note); } catch (e: any) { if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 }); return failure(e, "Failed to update note"); }
}
/** Compatibility-only destructive route. Sabah intentionally has no notes.delete capability. */
export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try { const session = await auth(); if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const note: any = await prisma.notePage.findUnique({ where: { id: params.id } }); if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 }); if (note.authorId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 }); await prisma.notePage.delete({ where: { id: params.id } }); return NextResponse.json({ success: true }); } catch (e) { return failure(e, "Failed to delete note"); }
}
