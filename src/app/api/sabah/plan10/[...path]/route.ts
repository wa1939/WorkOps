import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { SabahForbiddenError, toSabahActor } from "@/lib/sabah/auth/actor";

const MAX_BODY = 64 * 1024;
const MAX_RESPONSE = 64 * 1024;
const ALLOWED_PATHS = new Set([
    "monitor/run",
    "monitor/suggestions",
    "monitor/cases",
    "monitor/material-change",
    "monitor/cooldown",
    "monitor/snooze",
    "monitor/dismiss",
    "job/activity",
    "job/checkpoint",
    "job/lease-expire",
    "job/lease-renew",
    "job/tick",
    "job/cancel",
    "connector/test",
    "connector/delivery",
    "connector/inbound",
]);

type LocalParams = { params: Promise<{ path: string[] }> };
const unavailable = () => NextResponse.json({ error: "LOCAL_CONTROL_UNAVAILABLE" }, { status: 503 });
const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });

function localPort(): number | null {
    const text = process.env.SABAH_PLAN10_CONTROL_PORT ?? "4010";
    if (!/^\d{1,5}$/.test(text)) return null;
    const port = Number(text);
    return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

async function handle(request: Request, { params }: LocalParams): Promise<NextResponse> {
    let session;
    try { session = await auth(); } catch { return unauthorized(); }
    if (!session?.user?.id) return unauthorized();
    // Authorize from the persisted role, not the session JWT.
    try {
        const actor = await toSabahActor(session.user);
        if (actor.role !== "ADMIN") return forbidden();
    } catch (error) {
        if (error instanceof SabahForbiddenError) return forbidden();
        throw error;
    }
    if (process.env.SABAH_PLAN10_LOCAL_RUNTIME !== "1") return unavailable();
    const { path: pathSegments } = await params;
    const path = Array.isArray(pathSegments) ? pathSegments.join("/") : "";
    if (!ALLOWED_PATHS.has(path)) return unavailable();
    const port = localPort();
    if (port === null) return unavailable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
        const body = request.method === "POST" ? await request.text() : undefined;
        if (body !== undefined && body.length > MAX_BODY) return unavailable();
        const target = `http://127.0.0.1:${port}/${path}${new URL(request.url).search}`;
        const response = await fetch(target, { method: request.method, headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": request.headers.get("content-type") ?? "application/json" }) }, ...(body === undefined ? {} : { body }), signal: controller.signal });
        const text = await response.text();
        if (text.length > MAX_RESPONSE) return unavailable();
        return new NextResponse(text, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
    } catch { return unavailable(); } finally { clearTimeout(timer); }
}

export function GET(request: Request, context: LocalParams): Promise<NextResponse> { return handle(request, context); }
export function POST(request: Request, context: LocalParams): Promise<NextResponse> { return handle(request, context); }
