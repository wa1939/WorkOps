import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { AI_RATE_LIMIT, checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { enhanceReport, generateDraftForPeriod } from "@/lib/reports/commands";

const schema = z.object({ reportId: z.string().optional(), weekStart: z.coerce.date().optional(), weekEnd: z.coerce.date().optional(), instruction: z.string().max(4000).optional() });
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rate = await checkRateLimit(
      `ai:${session.user.id}`,
      AI_RATE_LIMIT.limit,
      AI_RATE_LIMIT.windowSec,
    );
    if (!rate.allowed) {
      const response = NextResponse.json({ error: "Rate limit exceeded. Please slow down." }, { status: 429 });
      response.headers.set("Retry-After", String(rate.retryAfterSec));
      return response;
    }

    const input = schema.parse(await request.json());
    const actor = { id: session.user.id!, role: session.user.role as any, departmentIds: [] };
    const result = input.reportId
      ? await enhanceReport({ reportId: input.reportId, instruction: input.instruction }, actor)
      : await generateDraftForPeriod({ weekStart: input.weekStart ?? new Date(Date.now() - 7 * 86400000), weekEnd: input.weekEnd ?? new Date(), instruction: input.instruction }, actor);
    return NextResponse.json({ success: true, aiSummary: result.body });
  } catch (error: any) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    const status = error?.status ?? 500;
    if (status !== 500) return NextResponse.json({ error: error.message }, { status });
    console.error("POST /api/reports/ai-enhance error:", error);
    return NextResponse.json({ error: "Failed to generate AI summary" }, { status: 500 });
  }
}
