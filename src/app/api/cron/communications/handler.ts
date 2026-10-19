import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { buildEmailSender } from "@/lib/communications/email";
import { buildPushSender, type PushSenderDatabase } from "@/lib/communications/push";
import { processCommunicationsRun, type DeliverySender } from "@/lib/communications/worker";
import { prisma } from "@/lib/prisma";

const requestSchema = z.object({
    batchSize: z.number().int().positive().max(50).optional(),
}).strict();

export type CommunicationsRouteDependencies = {
    db?: PrismaClient;
    sender?: DeliverySender;
    now?: Date;
};

function hasValidSecret(provided: string | null, expected: string | undefined): boolean {
    if (!provided || !expected) return false;
    const providedBuffer = Buffer.from(provided, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (providedBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(providedBuffer, expectedBuffer);
}

function buildDefaultEmailSender(): DeliverySender {
    return buildEmailSender({
        send: async ({ to, subject, html }) => {
            const apiKey = process.env.RESEND_API_KEY;
            if (!apiKey) throw new Error("Missing RESEND_API_KEY");
            const resend = new Resend(apiKey);
            const result = await resend.emails.send({
                from: process.env.EMAIL_FROM || "WorkOps <noreply@resend.dev>",
                to,
                subject,
                html,
            });
            return {
                data: result.data ? { id: result.data.id } : null,
                error: result.error ? { message: result.error.message } : null,
            };
        },
    });
}

function buildDefaultSender(db: PrismaClient): DeliverySender {
    const emailSender = buildDefaultEmailSender();
    const pushSender = buildPushSender(db as unknown as PushSenderDatabase);
    return async (delivery, event) => {
        if (delivery.channel === "email") return emailSender(delivery, event);
        if (delivery.channel === "push") return pushSender(delivery, event);
        return { outcome: "unknown", message: `unsupported channel: ${delivery.channel}` };
    };
}

async function parseRequestOptions(request: Request): Promise<{ batchSize?: number }> {
    const raw = await request.text();
    if (!raw.trim()) return {};
    return requestSchema.parse(JSON.parse(raw));
}

export async function POST(request: Request, dependencies: CommunicationsRouteDependencies = {}) {
    if (!hasValidSecret(request.headers.get("x-cron-secret"), process.env.CRON_SECRET)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let options: { batchSize?: number };
    try {
        options = await parseRequestOptions(request);
    } catch {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    try {
        const report = await processCommunicationsRun(
            dependencies.db ?? prisma,
            dependencies.sender ?? buildDefaultSender(dependencies.db ?? prisma),
            {
                now: dependencies.now,
                batchSize: options.batchSize,
            },
        );
        return NextResponse.json(report);
    } catch {
        return NextResponse.json({ error: "Communications run failed" }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ ok: true });
}
