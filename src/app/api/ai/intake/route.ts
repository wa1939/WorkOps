import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { getSabahFlags } from "@/lib/sabah/flags";
import {
    parseIntakeBuffer,
    INTAKE_MAX_BYTES,
    INTAKE_EXTENSIONS,
} from "@/lib/ai/intake-parse";

export const maxDuration = 30;
const INTAKE_MAX_PER_USER = 20;
const INTAKE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

class IntakeQuotaError extends Error {}

function ext(filename: string): string {
    const i = filename.lastIndexOf(".");
    return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (!getSabahFlags().platform) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        const actor = await toSabahActor(session.user);
        const rate = await checkRateLimit(actor.id);
        if (!rate.allowed) {
            const response = NextResponse.json(
                { error: "Rate limit exceeded. Please slow down.", resetAt: rate.resetAt },
                { status: 429 },
            );
            response.headers.set("Retry-After", String(rate.retryAfterSec ?? Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))));
            return response;
        }

        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }
        if (file.size > INTAKE_MAX_BYTES) {
            return NextResponse.json({ error: "File too large (max 2 MB)" }, { status: 413 });
        }
        if (!INTAKE_EXTENSIONS.includes(ext(file.name) as (typeof INTAKE_EXTENSIONS)[number])) {
            return NextResponse.json(
                { error: "Unsupported file type. Use Excel, CSV, Word, or a text file." },
                { status: 415 },
            );
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const parsed = await parseIntakeBuffer(file.name, buffer);

        const intake = await prisma.$transaction(async (transaction) => {
            await transaction.aiIntake.deleteMany({
                where: { userId: actor.id, createdAt: { lt: new Date(Date.now() - INTAKE_RETENTION_MS) } },
            });
            if (await transaction.aiIntake.count({ where: { userId: actor.id } }) >= INTAKE_MAX_PER_USER) {
                throw new IntakeQuotaError();
            }
            return transaction.aiIntake.create({
                data: {
                    userId: actor.id,
                    filename: file.name.slice(0, 255),
                    kind: parsed.kind,
                    rowsJson: parsed.kind === "rows" ? JSON.stringify({ headers: parsed.headers, rows: parsed.rows }) : null,
                    text: parsed.kind === "text" ? parsed.text : null,
                    rowCount: parsed.kind === "rows" ? parsed.rowCount : 0,
                },
                select: { id: true },
            });
        }, { isolationLevel: "Serializable" });

        if (parsed.kind === "rows") {
            return NextResponse.json({
                intakeId: intake.id,
                kind: "rows",
                filename: file.name,
                rowCount: parsed.rowCount,
                headers: parsed.headers,
                truncated: parsed.truncated,
                preview: parsed.rows.slice(0, 3),
            });
        }
        return NextResponse.json({
            intakeId: intake.id,
            kind: "text",
            filename: file.name,
            rowCount: 0,
            truncated: parsed.truncated,
            preview: parsed.text.slice(0, 400),
            total: parsed.text.length,
        });
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        if (error instanceof IntakeQuotaError) {
            return NextResponse.json({ error: "Upload limit reached. Remove or wait for older uploads to expire." }, { status: 429 });
        }
        console.error("POST /api/ai/intake error:", error);
        const msg = (error as Error).message === "Unsupported file type"
            ? "Unsupported file type. Use Excel, CSV, Word, or a text file."
            : "Failed to read the file.";
        return NextResponse.json({ error: msg }, { status: 400 });
    }
}
