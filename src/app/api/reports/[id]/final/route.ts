import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { finalizeReport, saveFinalBody, type ReportActor, type ReportFeedbackRecorder } from "@/lib/reports/commands";
import { createFeedbackService, createPrismaFeedbackRepository } from "@/lib/sabah/feedback/service";
import { toSabahActor } from "@/lib/sabah/auth/actor";
export const maxDuration = 60;
const bodySchema = z.object({ finalBody: z.string().min(1).max(20000) }).strict();
const postSchema = bodySchema.extend({ approved: z.literal(true), learn: z.boolean().default(false) }).strict();
const errorDetails = (error: unknown) => {
  if (!error || typeof error !== "object") return { message: "Request failed", status: 500 };
  const candidate = error as { message?: unknown; status?: unknown };
  return { message: typeof candidate.message === "string" ? candidate.message : "Request failed", status: typeof candidate.status === "number" ? candidate.status : 500 };
};
async function admin() { const session = await auth(); if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }; const actor = await toSabahActor(session.user); if (actor.role !== "ADMIN") return { error: NextResponse.json({ error: "Admin only" }, { status: 403 }) }; return { actor }; }
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const gate = await admin(); if (gate.error) return gate.error; const { id } = await params; const input = bodySchema.parse(await request.json()); const result = await saveFinalBody(id, input.finalBody, gate.actor as ReportActor); return NextResponse.json({ success: true, reportId: result.id, finalBody: result.finalBody, submittedAt: result.submittedAt }); } catch (error: unknown) { if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors[0].message }, { status: 400 }); const details = errorDetails(error); return NextResponse.json({ error: details.message || "Failed to save draft" }, { status: details.status }); } }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { const gate = await admin(); if (gate.error) return gate.error; const { id } = await params; const input = postSchema.parse(await request.json()); const reportActor: ReportActor = gate.actor as ReportActor;
 const feedback = createFeedbackService(createPrismaFeedbackRepository(), { authorizeSource: async (source) => source.kind === "REPORT" && source.id === id, authorizeScope: async (scope, scopeId, feedbackActor) => scope === "PERSONAL" && scopeId === feedbackActor.id });
 const recorder: ReportFeedbackRecorder = async (feedbackInput, reportFeedbackActor) => { await feedback.recordFeedback(feedbackInput, { id: reportFeedbackActor.id, scope: "PERSONAL", scopeId: reportFeedbackActor.id }); };
 const result = await finalizeReport({ reportId: id, finalBody: input.finalBody, approved: true, learn: input.learn }, reportActor, recorder); return NextResponse.json({ success: true, learned: result.learned, learningProposalId: result.learningProposalId, learningDisabled: result.learningDisabled, verified: result.verified, publication: result.publication }); } catch (error: unknown) { if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors[0].message }, { status: 400 }); const details = errorDetails(error); return NextResponse.json({ error: details.message || "Failed to submit" }, { status: details.status }); } }
