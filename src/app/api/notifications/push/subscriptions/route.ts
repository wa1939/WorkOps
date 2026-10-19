import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptPushSubscriptionValue } from "@/lib/pwa/crypto";
import { isApprovedPushEndpoint } from "@/lib/pwa/endpoint-guard";

export const runtime = "nodejs";

const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_KEY_LENGTH = 512;
const MAX_INSTALLATION_ID_LENGTH = 128;

const registrationSchema = z.object({
    endpoint: z.string().url().max(MAX_ENDPOINT_LENGTH),
    keys: z.object({
        p256dh: z.string().min(1).max(MAX_KEY_LENGTH),
        auth: z.string().min(1).max(MAX_KEY_LENGTH),
    }),
    // The authenticated session remains the source of userId. This optional
    // device label is not an identity claim and is bounded before persistence.
    installationId: z.string().min(1).max(MAX_INSTALLATION_ID_LENGTH).optional(),
});

const deleteSchema = z.object({
    endpoint: z.string().url().max(MAX_ENDPOINT_LENGTH),
});

type Registration = z.infer<typeof registrationSchema>;

type PublicSubscription = {
    id: string;
    endpointHash: string;
    installationId: string;
    enabled: boolean;
    createdAt: Date;
    lastSeenAt: Date;
    revokedAt: Date | null;
};

function jsonError(code: string, status: number, message: string) {
    return NextResponse.json({ code, error: message }, { status });
}

function endpointDigest(endpoint: string): string {
    return createHash("sha256").update(endpoint, "utf8").digest("hex");
}

function toPublicSubscription(subscription: PublicSubscription) {
    return {
        id: subscription.id,
        endpointHash: subscription.endpointHash,
        installationId: subscription.installationId,
        enabled: subscription.enabled,
        createdAt: subscription.createdAt,
        lastSeenAt: subscription.lastSeenAt,
        revokedAt: subscription.revokedAt,
    };
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function parseEndpoint(value: unknown): string | null {
    const result = z.string().url().max(MAX_ENDPOINT_LENGTH).safeParse(value);
    if (!result.success || !isApprovedPushEndpoint(result.data)) {
        return null;
    }
    return result.data;
}

function readInstallationId(request: Request, registration: Registration): string {
    const headerValue = request.headers.get("x-installation-id");
    return registration.installationId ?? headerValue?.slice(0, MAX_INSTALLATION_ID_LENGTH) ?? "web";
}

function encryptedValues(registration: Registration) {
    return {
        endpointEncrypted: encryptPushSubscriptionValue(registration.endpoint),
        p256dhEncrypted: encryptPushSubscriptionValue(registration.keys.p256dh),
        authEncrypted: encryptPushSubscriptionValue(registration.keys.auth),
    };
}

async function authenticatedUserId(): Promise<string | null> {
    const session = await auth();
    const userId = session?.user?.id;
    return typeof userId === "string" && userId.length > 0 ? userId : null;
}

export async function POST(request: Request) {
    const userId = await authenticatedUserId();
    if (!userId) {
        return jsonError("UNAUTHENTICATED", 401, "Authentication required");
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonError("INVALID_SUBSCRIPTION", 400, "Invalid subscription payload");
    }

    const parsed = registrationSchema.safeParse(body);
    if (!parsed.success || !isApprovedPushEndpoint(parsed.success ? parsed.data.endpoint : "")) {
        return jsonError("INVALID_SUBSCRIPTION", 400, "Invalid push subscription endpoint or keys");
    }

    const registration = parsed.data;
    const endpointHash = endpointDigest(registration.endpoint);
    const existing = await prisma.pushSubscription.findUnique({ where: { endpointHash } });

    if (existing && existing.userId !== userId) {
        return jsonError("DUPLICATE_ENDPOINT", 409, "Subscription endpoint already belongs to another user");
    }

    try {
        if (existing) {
            const updated = await prisma.pushSubscription.update({
                where: { id: existing.id },
                data: {
                    ...encryptedValues(registration),
                    ...(registration.installationId || request.headers.get("x-installation-id")
                        ? { installationId: readInstallationId(request, registration) }
                        : {}),
                    lastSeenAt: new Date(),
                    enabled: true,
                    revokedAt: null,
                },
            });
            return NextResponse.json(toPublicSubscription(updated), { status: 200 });
        }

        const created = await prisma.pushSubscription.create({
            data: {
                userId,
                installationId: readInstallationId(request, registration),
                ...encryptedValues(registration),
                endpointHash,
                keyVersion: "v1",
            },
        });
        return NextResponse.json(toPublicSubscription(created), { status: 201 });
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            const conflicting = await prisma.pushSubscription.findUnique({ where: { endpointHash } });
            if (conflicting && conflicting.userId !== userId) {
                return jsonError("DUPLICATE_ENDPOINT", 409, "Subscription endpoint already belongs to another user");
            }
            if (conflicting) {
                const updated = await prisma.pushSubscription.update({
                    where: { id: conflicting.id },
                    data: {
                        ...encryptedValues(registration),
                        lastSeenAt: new Date(),
                        enabled: true,
                        revokedAt: null,
                    },
                });
                return NextResponse.json(toPublicSubscription(updated), { status: 200 });
            }
        }
        return jsonError("SUBSCRIPTION_STORAGE_ERROR", 500, "Unable to store push subscription");
    }
}

export async function DELETE(request: Request) {
    const userId = await authenticatedUserId();
    if (!userId) {
        return jsonError("UNAUTHENTICATED", 401, "Authentication required");
    }

    const queryEndpoint = new URL(request.url).searchParams.get("endpoint");
    let bodyEndpoint: unknown;
    if (!queryEndpoint) {
        try {
            const body = await request.json();
            bodyEndpoint = deleteSchema.safeParse(body).success
                ? (body as { endpoint: string }).endpoint
                : null;
        } catch {
            bodyEndpoint = null;
        }
    }

    const endpoint = parseEndpoint(queryEndpoint ?? bodyEndpoint);
    if (!endpoint) {
        return jsonError("INVALID_SUBSCRIPTION", 400, "Invalid push subscription endpoint");
    }

    const revokedAt = new Date();
    const result = await prisma.pushSubscription.updateMany({
        where: { endpointHash: endpointDigest(endpoint), userId },
        data: { enabled: false, revokedAt },
    });

    if (result.count === 0) {
        return jsonError("NOT_FOUND", 404, "Push subscription not found");
    }

    const updated = await prisma.pushSubscription.findUnique({
        where: { endpointHash: endpointDigest(endpoint) },
    });
    return NextResponse.json(updated ? toPublicSubscription(updated) : { ok: true }, { status: 200 });
}
