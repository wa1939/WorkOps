import { NextResponse, type NextRequest } from "next/server";
import { verifyInboundWebhook } from "../../../../../../lib/sabah/connectors/adapters/webhook";
import { getWebhookRuntime } from "./runtime";

const MAX_ROUTE_BODY_BYTES = 64 * 1024;
const statusForCode = (code: string): number => code === "accepted" ? 202 : code === "body_too_large" ? 413 : code === "unavailable" ? 503 : code === "replay" ? 409 : 400;
async function readBoundedBody(request: NextRequest): Promise<{ body?: string; tooLarge: boolean }> {
  if (!request.body) return { body: "", tooLarge: false };
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (total <= MAX_ROUTE_BODY_BYTES) {
      const next = await reader.read(); if (next.done) break;
      const chunk = next.value; const remaining = MAX_ROUTE_BODY_BYTES + 1 - total;
      if (chunk.byteLength > remaining) { chunks.push(chunk.slice(0, remaining)); total += remaining; await reader.cancel(); return { tooLarge: true }; }
      chunks.push(chunk); total += chunk.byteLength;
    }
  } finally { reader.releaseLock(); }
  if (total > MAX_ROUTE_BODY_BYTES) return { tooLarge: true };
  try { return { body: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), tooLarge: false }; } catch { return { tooLarge: false }; }
}
export async function POST(request: NextRequest, context: { params: Promise<{ connectorKey: string }> }): Promise<NextResponse> {
  const runtime = getWebhookRuntime();
  if (!runtime) return NextResponse.json({ ok: false, code: "unavailable" }, { status: 503 });
  try {
    const read = await readBoundedBody(request);
    if (read.tooLarge) return NextResponse.json({ ok: false, code: "body_too_large" }, { status: 413 });
    const connector = await runtime.resolveConnector((await context.params).connectorKey);
    if (!connector || connector.connectorKey !== (await context.params).connectorKey || connector.enabled !== true || (connector.direction !== "INBOUND" && connector.direction !== "BIDIRECTIONAL")) return NextResponse.json({ ok: false, code: "unavailable" }, { status: 503 });
    if (read.body === undefined) return NextResponse.json({ ok: false, code: "unavailable" }, { status: 503 });
    const result = await verifyInboundWebhook({ body: read.body, headers: request.headers, connector });
    return NextResponse.json({ ok: result.code === "accepted", code: result.code }, { status: statusForCode(result.code) });
  } catch { return NextResponse.json({ ok: false, code: "unavailable" }, { status: 503 }); }
}
