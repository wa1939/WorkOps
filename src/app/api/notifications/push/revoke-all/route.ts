import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Revoke every push subscription belonging to the signed-in account. Called by
 * the client immediately before sign-out so a shared device stops receiving
 * this account's notifications. The browser subscription itself is
 * unsubscribed client-side after the call; rows stay for audit and are
 * re-enabled if the account re-subscribes on the same endpoint.
 */
export async function POST() {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const revokedAt = new Date();
    const result = await prisma.pushSubscription.updateMany({
        where: { userId, enabled: true, revokedAt: null },
        data: { enabled: false, revokedAt },
    });

    return NextResponse.json({ ok: true, revokedCount: result.count });
}
