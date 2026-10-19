import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { getSabahFlags } from "@/lib/sabah/flags";
import { callGLM, type GLMMessage } from "@/lib/glm";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { resolveRuntimeProviderCredentials, type RuntimeProviderCredentials } from "@/lib/sabah/providers/admin-service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GENERATION_TIMEOUT_MS = 25_000;
const MAX_PROPOSAL_TOKENS = 400;

const requestSchema = z.object({
    entityType: z.string().min(1).max(40),
    fieldName: z.string().min(1).max(60),
    fieldLabel: z.string().min(1).max(120),
    currentValue: z.string().max(8000),
    instruction: z.string().max(500).optional(),
    context: z
        .record(z.string().max(2000))
        .refine((record) => Object.keys(record).length <= 12, { message: "Too many context fields" })
        .optional()
        .default({}),
});

const SYSTEM_PROMPT = [
    "You are Sabah, a professional bilingual (Arabic/English) workspace copilot for the WorkOps.",
    "Draft a concise, high-quality value for exactly ONE form field.",
    "You are given the entity type, the field label, the field's current value, and sibling field values for context.",
    "Match the language of the surrounding content (Arabic or English).",
    "Respond with ONLY the proposed field text — no markdown fences, no preamble, no explanations, no surrounding quotes.",
].join(" ");

function stripFences(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
    return (fenced ? fenced[1] : trimmed).trim();
}

function buildUserPrompt(input: z.infer<typeof requestSchema>): string {
    const siblings = Object.entries(input.context)
        .map(([name, value]) => `- ${name}: ${value}`)
        .join("\n");
    return [
        `Entity type: ${input.entityType}`,
        `Field: ${input.fieldLabel} (${input.fieldName})`,
        `Current value: ${input.currentValue === "" ? "(empty)" : input.currentValue}`,
        siblings ? `Other fields:\n${siblings}` : "Other fields: (none)",
        input.instruction ? `Instruction: ${input.instruction}` : "",
        "Draft the proposed value for this field now.",
    ].filter(Boolean).join("\n\n");
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!getSabahFlags().platform) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
        await toSabahActor(session.user);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        throw error;
    }

    let runtimeCredentials: RuntimeProviderCredentials = {};
    try {
        runtimeCredentials = await resolveRuntimeProviderCredentials();
    } catch {
        // Stored credentials are optional; environment credentials may still work.
    }
    if (!process.env.GLM_API_KEY && !process.env.NUHA_API_KEY && !runtimeCredentials.zai && !runtimeCredentials.nuha) {
        return NextResponse.json({ error: "AI is not configured" }, { status: 503 });
    }

    const rate = await checkRateLimit(session.user.id);
    if (!rate.allowed) {
        const response = NextResponse.json(
            { error: "Rate limit exceeded. Please slow down.", resetAt: rate.resetAt },
            { status: 429 },
        );
        response.headers.set("Retry-After", String(rate.retryAfterSec ?? Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))));
        return response;
    }

    let parsed: z.infer<typeof requestSchema>;
    try {
        parsed = requestSchema.parse(await request.json());
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
        }
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Draft-only generation: nothing is written server-side. The client stages
    // the proposal and the user applies it explicitly in the form review flow.
    const messages: GLMMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(parsed) },
    ];

    try {
        const response = await callGLM({
            model: "glm-4.5-flash",
            credentials: runtimeCredentials,
            messages,
            temperature: 0.4,
            max_tokens: MAX_PROPOSAL_TOKENS,
            signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
        });
        const proposed = stripFences(response.content ?? "");
        if (!proposed) {
            return NextResponse.json({ error: "Sabah returned an empty draft" }, { status: 502 });
        }
        return NextResponse.json({ proposed, base: parsed.currentValue });
    } catch (error) {
        console.error("POST /api/ai/field-assist generation failed:", error);
        return NextResponse.json({ error: "Sabah could not draft this field" }, { status: 502 });
    }
}
