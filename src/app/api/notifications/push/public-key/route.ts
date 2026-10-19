import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Public VAPID application server key for push subscription. This value is
 * designed to be public (it is sent to push services with every subscription);
 * the private key never leaves the server env.
 */
export async function GET() {
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    if (!publicKey) {
        return NextResponse.json({ error: "Push is not configured" }, { status: 503 });
    }
    return NextResponse.json(
        { publicKey },
        { headers: { "cache-control": "no-store" } },
    );
}
