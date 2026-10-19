import { createHmac, timingSafeEqual } from "node:crypto";
import { type PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canTransition, type DeliveryState } from "@/lib/communications/contracts";

const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

type WebhookPayload = {
    type: string;
    data: {
        email_id: string;
    };
};

export type EmailWebhookRouteDependencies = {
    db?: PrismaClient;
    now?: Date;
    webhookSecret?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parsePayload(rawBody: string): WebhookPayload {
    const parsed: unknown = JSON.parse(rawBody);
    if (!isRecord(parsed) || typeof parsed.type !== "string" || !isRecord(parsed.data) || typeof parsed.data.email_id !== "string") {
        throw new Error("Invalid webhook payload");
    }
    return {
        type: parsed.type,
        data: { email_id: parsed.data.email_id },
    };
}

function decodeWebhookSecret(secret: string): Buffer {
    const encoded = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
    return Buffer.from(encoded, "base64");
}

function hasValidSignature(
    rawBody: string,
    id: string | null,
    timestamp: string | null,
    signatureHeader: string | null,
    secret: string | undefined,
    now: Date,
): boolean {
    if (!id || !timestamp || !signatureHeader || !secret) return false;

    const timestampSeconds = Number(timestamp);
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (!Number.isInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) {
        return false;
    }

    const expected = createHmac("sha256", decodeWebhookSecret(secret))
        .update(`${id}.${timestamp}.${rawBody}`)
        .digest();

    return signatureHeader.split(/\s+/).some((candidate) => {
        const encodedSignature = candidate.startsWith("v1,") ? candidate.slice(3) : candidate;
        if (!encodedSignature) return false;
        const provided = Buffer.from(encodedSignature, "base64");
        if (provided.length !== expected.length) return false;
        return timingSafeEqual(expected, provided);
    });
}

function targetStateForEvent(type: string): DeliveryState | null {
    switch (type) {
        case "email.delivered":
            return "DELIVERED";
        case "email.bounced":
        case "email.complained":
            return "BOUNCED";
        case "email.sent":
            return "ACCEPTED";
        default:
            return null;
    }
}

export async function POST(request: Request, dependencies: EmailWebhookRouteDependencies = {}) {
    const rawBody = await request.text();
    const now = dependencies.now ?? new Date();
    const valid = hasValidSignature(
        rawBody,
        request.headers.get("svix-id"),
        request.headers.get("svix-timestamp"),
        request.headers.get("svix-signature"),
        dependencies.webhookSecret ?? process.env.WEBHOOK_SECRET,
        now,
    );
    if (!valid) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let payload: WebhookPayload;
    try {
        payload = parsePayload(rawBody);
    } catch {
        return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }

    const targetState = targetStateForEvent(payload.type);
    if (!targetState) {
        return NextResponse.json({ applied: false });
    }

    const db = dependencies.db ?? prisma;
    const delivery = await db.delivery.findFirst({
        where: { providerId: payload.data.email_id },
    });
    if (!delivery || !canTransition(delivery.state as DeliveryState, targetState)) {
        return NextResponse.json({ applied: false });
    }

    const data: {
        state: DeliveryState;
        acceptedAt?: Date;
        deliveredAt?: Date | null;
        lastError?: string | null;
    } = {
        state: targetState,
    };
    if (targetState === "ACCEPTED") {
        data.acceptedAt = now;
        data.lastError = null;
    } else if (targetState === "DELIVERED") {
        data.deliveredAt = now;
        data.lastError = null;
    } else if (targetState === "BOUNCED") {
        data.deliveredAt = null;
    }

    await db.delivery.update({
        where: { id: delivery.id },
        data,
    });
    return NextResponse.json({ applied: true });
}
