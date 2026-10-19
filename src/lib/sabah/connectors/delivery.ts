import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { isIP } from "node:net";
import type { SabahLifecycleEvent } from "../events/contracts";

export type DeliveryRecord = { replayId: string; status: number | null; bodyHash: string | null; attempts: number; outcome: "delivered" | "terminal_failure" | "retry_exhausted" | "circuit_open" | "network_failure" };
export interface DeliveryStore { claimReplay(replayId: string): Promise<boolean>; recordDelivery(record: DeliveryRecord): Promise<void>; releaseReplay(replayId: string): Promise<void>; }
export type WebhookFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type WebhookCircuit = { isOpen(): boolean; recordFailure(): void; recordSuccess(): void };
export type EndpointResolver = (hostname: string) => Promise<readonly string[]>;
export type DeliveryOptions = { event: SabahLifecycleEvent; url: string; secret: string; timestamp?: number; store: DeliveryStore; fetcher?: WebhookFetcher; sleep?: (ms: number) => Promise<void>; maxAttempts?: number; timeoutMs?: number; circuit?: WebhookCircuit; endpointPolicy: { allowedHosts: readonly string[]; resolveHost: EndpointResolver } };
export type DeliveryResult = { code: "delivered" | "terminal_failure" | "retry_exhausted" | "replay" | "circuit_open" | "network_failure"; replayId?: string };

const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENT_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const sleepDefault = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
class ResponseBodyTooLargeError extends Error {}
async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) return Buffer.concat(chunks, total);
      const chunk = next.value;
      if (chunk.byteLength > MAX_RESPONSE_BYTES - total) {
        await reader.cancel();
        throw new ResponseBodyTooLargeError("webhook_response_too_large");
      }
      chunks.push(chunk); total += chunk.byteLength;
    }
  } finally { reader.releaseLock(); }
}
const hmac = (secret: string, timestamp: number, body: string) => createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");

function forbiddenAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) { const parts = address.split(".").map(Number); return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || parts[0] >= 224 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168); }
  if (version === 6) { const normalized = address.toLowerCase(); const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); return Boolean(mapped && forbiddenAddress(mapped[1])) || normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff"); }
  return true;
}
async function resolveWebhookEndpoint(rawUrl: string, allowedHosts: readonly string[], resolveHost: EndpointResolver): Promise<{ url: URL; address: string }> {
  const url = new URL(rawUrl); const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !allowedHosts.some((host) => host.toLowerCase().replace(/\.$/, "") === hostname)) throw new Error("unsafe_webhook_endpoint");
  const addresses = await resolveHost(hostname);
  if (!addresses.length || addresses.some(forbiddenAddress)) throw new Error("unsafe_webhook_address");
  return { url, address: addresses[0] };
}
export async function validateWebhookEndpoint(rawUrl: string, allowedHosts: readonly string[], resolveHost: EndpointResolver): Promise<string> {
  return (await resolveWebhookEndpoint(rawUrl, allowedHosts, resolveHost)).url.toString();
}

export function createPinnedRequestOptions(target: URL, address: string, init: RequestInit): { protocol: "https:"; hostname: string; port: string | number; path: string; method?: string; headers: Record<string, string>; servername: string; rejectUnauthorized: true } {
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  return { protocol: "https:", hostname: address, port: target.port || 443, path: `${target.pathname}${target.search}`, method: init.method, headers: { ...headers, host: target.host }, servername: target.hostname, rejectUnauthorized: true };
}
function pinnedFetch(target: URL, address: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(createPinnedRequestOptions(target, address, init), (res) => {
      resolve(new Response(Readable.toWeb(res) as ReadableStream, { status: res.statusCode, headers: res.headers as Record<string, string> }));
    });
    req.once("error", reject);
    if (init.signal) init.signal.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true });
    if (typeof init.body === "string") req.write(init.body);
    req.end();
  });
}

function canonicalEnvelope(event: SabahLifecycleEvent, timestamp: number): { replayId: string; body: string } {
  const replayId = hash(event.id).slice(0, 48);
  const envelope = { eventId: event.id, replayId, event: event.name, occurredAt: event.occurredAt, correlationId: event.correlationId, actorId: event.actorId, entityRefs: event.entityRefs };
  const body = JSON.stringify(envelope); if (Buffer.byteLength(body) > MAX_EVENT_BYTES) throw new Error("event_too_large"); return { replayId, body };
}
export async function createSignedWebhookDelivery(options: DeliveryOptions): Promise<DeliveryResult> {
  return deliverWebhook(options);
}
export async function deliverWebhook(options: DeliveryOptions): Promise<DeliveryResult> {
  const resolved = await resolveWebhookEndpoint(options.url, options.endpointPolicy.allowedHosts, options.endpointPolicy.resolveHost);
  const pinnedUrl = new URL(resolved.url); pinnedUrl.hostname = resolved.address;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000); const { replayId, body } = canonicalEnvelope(options.event, timestamp);
  if (!(await options.store.claimReplay(replayId))) return { code: "replay", replayId };
  if (options.circuit?.isOpen()) { await options.store.recordDelivery({ replayId, status: null, bodyHash: null, attempts: 0, outcome: "circuit_open" }); return { code: "circuit_open", replayId }; }
  const fetcher = options.fetcher ?? ((input, init) => pinnedFetch(resolved.url, resolved.address, init ?? {})); const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 5)); const wait = options.sleep ?? sleepDefault;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs ?? 10_000));
    let response: Response | undefined;
    try {
      response = await fetcher(pinnedUrl, { method: "POST", body, redirect: "error", signal: controller.signal, headers: { "content-type": "application/json", host: resolved.url.host, "x-sabah-event": options.event.name, "x-sabah-event-id": options.event.id, "x-sabah-replay-id": replayId, "x-sabah-timestamp": String(timestamp), "x-sabah-signature": `sha256=${hmac(options.secret, timestamp, body)}` } });
      const status = response.status; const outcome = status >= 200 && status < 300 ? "delivered" : status >= 400 && status < 500 ? "terminal_failure" : attempt === maxAttempts ? "retry_exhausted" : null;
      const responseBytes = await readBoundedResponse(response);
      await options.store.recordDelivery({ replayId, status, bodyHash: hash(responseBytes), attempts: attempt, outcome: outcome ?? "retry_exhausted" });
      clearTimeout(timer);
      if (outcome === "delivered") { options.circuit?.recordSuccess(); return { code: "delivered", replayId }; }
      if (outcome === "terminal_failure") return { code: "terminal_failure", replayId };
      options.circuit?.recordFailure(); if (attempt < maxAttempts) await wait(1000 * 2 ** (attempt - 1));
    } catch {
      clearTimeout(timer); options.circuit?.recordFailure(); const final = attempt === maxAttempts;
      await options.store.recordDelivery({ replayId, status: response?.status ?? null, bodyHash: null, attempts: attempt, outcome: final ? "network_failure" : "retry_exhausted" });
      if (final) return { code: "network_failure", replayId }; await wait(1000 * 2 ** (attempt - 1));
    }
  }
  return { code: "retry_exhausted", replayId };
}
export function constantTimeSignatureEqual(expected: string, provided: string): boolean { const a = Buffer.from(expected); const b = Buffer.from(provided); return a.length === b.length && timingSafeEqual(a, b); }
export { MAX_BODY_BYTES };
