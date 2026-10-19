import { describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { createSignedWebhookDelivery, createPinnedRequestOptions, deliverWebhook, validateWebhookEndpoint, type DeliveryStore, type WebhookFetcher } from "./delivery";
import { verifyInboundWebhook, type VerifiedInboundConnector } from "./adapters/webhook";

type Claim = { replayId: string; claimed: boolean };
const store = (claims: Claim[] = []): DeliveryStore & { claims: Claim[]; records: unknown[] } => ({
  claims, records: [],
  async claimReplay(replayId) { const existing = this.claims.find((x) => x.replayId === replayId); if (existing) return false; this.claims.push({ replayId, claimed: true }); return true; },
  async recordDelivery(record) { this.records.push(record); },
  async releaseReplay(replayId) { const index = this.claims.findIndex((claim) => claim.replayId === replayId); if (index >= 0) this.claims.splice(index, 1); },
});
const event = { id: "evt-1", name: "step.completed" as const, occurredAt: "2026-08-30T00:00:00.000Z", correlationId: "corr", actorId: null, entityRefs: [], payload: { safe: "ok" } };
const fetcher = (responses: Response[]): WebhookFetcher => vi.fn(async (input, init) => { void new Request(input, init); return responses.shift() ?? new Response("", { status: 500 }); });
const endpointPolicy = { allowedHosts: ["hooks.example.test"], resolveHost: async () => ["93.184.216.34"] };
const inboundConnector = (storeValue: DeliveryStore, sink: (suggestion: unknown) => void, overrides: Partial<VerifiedInboundConnector> = {}): VerifiedInboundConnector => ({ connectorKey: "acme", enabled: true, direction: "INBOUND", allowedEvents: ["step.completed"], secret: "secret", store: storeValue, suggestionSink: sink, ...overrides });

describe("signed webhook delivery", () => {
  it("signs exact timestamp.body bytes and sends only the bounded envelope", async () => {
    const s = store(); const fetch = fetcher([new Response("accepted", { status: 202 })]);
    const result = await createSignedWebhookDelivery({ event, url: "https://hooks.example.test/events", secret: "secret", timestamp: 1_700_000_000, store: s, fetcher: fetch, timeoutMs: 1000, endpointPolicy });
    expect(result.code).toBe("delivered");
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const request = new Request(call[0], call[1]);
    const body = await request.text();
    expect(request.url).toBe("https://93.184.216.34/events");
    expect(request.headers.get("host")).toBe("hooks.example.test");
    expect(request.redirect).toBe("error");
    expect(request.headers.get("x-sabah-signature")).toBe(`sha256=${createHmac("sha256", "secret").update(`1700000000.${body}`).digest("hex")}`);
    expect(JSON.parse(body)).toMatchObject({ eventId: "evt-1", replayId: expect.any(String), event: "step.completed" });
    expect(body).not.toContain("secret"); expect(body).not.toContain("accepted");
  });
  it("rejects an unsafe endpoint at the delivery boundary before claiming or fetching", async () => {
    const s = store(); const fetch = fetcher([new Response("", { status: 200 })]);
    await expect(deliverWebhook({ event, url: "https://hooks.example.test/events", secret: "secret", timestamp: 1_700_000_000, store: s, fetcher: fetch, endpointPolicy: { allowedHosts: ["hooks.example.test"], resolveHost: async () => ["127.0.0.1"] } })).rejects.toThrow("unsafe_webhook_address");
    expect(s.claims).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
  });
  it("claims the same replay key when timestamp changes", async () => {
    const s = store(); const fetch = fetcher([new Response("", { status: 202 })]);
    const first = await deliverWebhook({ event, url: "https://hooks.example.test/events", secret: "secret", store: s, fetcher: fetch, endpointPolicy });
    const second = await deliverWebhook({ event, url: "https://hooks.example.test/events", secret: "secret", timestamp: 1_700_000_999, store: s, fetcher: fetch, endpointPolicy });
    expect(first.code).toBe("delivered"); expect(second.code).toBe("replay"); expect(fetch).toHaveBeenCalledOnce();
  });
  it("rejects an oversized response without fully buffering it", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(64 * 1024)); controller.enqueue(new Uint8Array(1)); },
      cancel() { cancelled = true; },
    }), { status: 200 });
    const s = store();
    const result = await deliverWebhook({ event, url: "https://hooks.example.test/events", secret: "secret", timestamp: 1_700_000_000, store: s, fetcher: fetcher([response]), maxAttempts: 1, endpointPolicy });
    expect(result.code).toBe("network_failure");
    expect(cancelled).toBe(true);
    expect(s.records).toEqual([expect.objectContaining({ status: 200, bodyHash: null, attempts: 1 })]);
  });
  it("uses terminal 4xx and bounded retry/backoff for 5xx", async () => {
    const s = store(); const delays: number[] = [];
    const result = await deliverWebhook({ event, url: "https://hooks.example.test/events", secret: "secret", timestamp: 1_700_000_000, store: s, fetcher: fetcher([new Response("", { status: 500 }), new Response("", { status: 502 }), new Response(null, { status: 204 })]), maxAttempts: 3, sleep: async (ms) => { delays.push(ms); }, endpointPolicy });
    expect(result.code).toBe("delivered"); expect(delays).toEqual([1000, 2000]); expect(s.records).toHaveLength(3);
    expect((await deliverWebhook({ event, url: "https://hooks.example.test/events", secret: "secret", timestamp: 1_700_000_000, store: store(), fetcher: fetcher([new Response("", { status: 400 })]), endpointPolicy })).code).toBe("terminal_failure");
  });
  it("rejects unsafe endpoints deterministically", async () => {
    await expect(validateWebhookEndpoint("http://hooks.example.test", ["hooks.example.test"], async () => ["93.184.216.34"])).rejects.toThrow();
    await expect(validateWebhookEndpoint("https://other.example.test", ["hooks.example.test"], async () => ["93.184.216.34"])).rejects.toThrow();
    await expect(validateWebhookEndpoint("https://hooks.example.test", ["hooks.example.test"], async () => ["127.0.0.1"])).rejects.toThrow();
    await expect(validateWebhookEndpoint("https://hooks.example.test/path?token=secret", ["hooks.example.test"], async () => ["93.184.216.34"])).rejects.toThrow();
    await expect(validateWebhookEndpoint("https://hooks.example.test", ["hooks.example.test"], async () => ["::ffff:127.0.0.1"])).rejects.toThrow();
    await expect(validateWebhookEndpoint("https://hooks.example.test", ["hooks.example.test"], async () => ["::ffff:10.0.0.1"])).rejects.toThrow();
    await expect(validateWebhookEndpoint("https://hooks.example.test", ["hooks.example.test"], async () => ["93.184.216.34", "127.0.0.1"])).rejects.toThrow();
  });
  it("keeps the original hostname for native HTTPS Host and TLS SNI", () => {
    const options = createPinnedRequestOptions(new URL("https://hooks.example.test/events"), "93.184.216.34", { method: "POST", headers: { "content-type": "application/json" } });
    expect(options.hostname).toBe("93.184.216.34");
    expect(options.servername).toBe("hooks.example.test");
    expect(options.headers.host).toBe("hooks.example.test");
  });
});

describe("signed inbound webhook", () => {
  it("verifies exact raw bytes, replay, skew, allowlist, and only writes a suggestion", async () => {
    const body = JSON.stringify({ event: "step.completed", eventId: "evt-in", payload: { safe: true } }); const timestamp = 1700000000;
    const signature = `sha256=${createHmac("sha256", "secret").update(`${timestamp}.${body}`).digest("hex")}`; const s = store(); const suggest = vi.fn();
    const result = await verifyInboundWebhook({ body, headers: { "x-sabah-timestamp": String(timestamp), "x-sabah-signature": signature }, now: 1700000000, maxBodyBytes: 1000, connector: inboundConnector(s, suggest) });
    expect(result.code).toBe("accepted"); expect(suggest).toHaveBeenCalledOnce();
    await expect(verifyInboundWebhook({ body: `${body} `, headers: { "x-sabah-timestamp": String(timestamp), "x-sabah-signature": signature }, now: timestamp, connector: inboundConnector(store(), suggest) })).resolves.toMatchObject({ code: "invalid_signature" });
    await expect(verifyInboundWebhook({ body, headers: { "x-sabah-timestamp": String(timestamp - 301), "x-sabah-signature": signature }, now: timestamp, connector: inboundConnector(store(), suggest) })).resolves.toMatchObject({ code: "timestamp_skew" });
    await expect(verifyInboundWebhook({ body, headers: { "x-sabah-timestamp": String(timestamp), "x-sabah-signature": signature }, now: timestamp, connector: inboundConnector(s, suggest) })).resolves.toMatchObject({ code: "replay" });
    expect(suggest).toHaveBeenCalledOnce();
  });
  it("rejects disabled, outbound-only, and disallowed governed connectors before the sink", async () => {
    const sink = vi.fn(); const body = JSON.stringify({ event: "step.completed", eventId: "evt-policy", payload: {} }); const timestamp = 1700000000; const signature = `sha256=${createHmac("sha256", "secret").update(`${timestamp}.${body}`).digest("hex")}`;
    await expect(verifyInboundWebhook({ body, headers: { "x-sabah-timestamp": String(timestamp), "x-sabah-signature": signature }, now: timestamp, connector: inboundConnector(store(), sink, { enabled: false }) })).resolves.toMatchObject({ code: "unavailable" });
    await expect(verifyInboundWebhook({ body, headers: { "x-sabah-timestamp": String(timestamp), "x-sabah-signature": signature }, now: timestamp, connector: inboundConnector(store(), sink, { direction: "OUTBOUND" }) })).resolves.toMatchObject({ code: "unavailable" });
    await expect(verifyInboundWebhook({ body, headers: { "x-sabah-timestamp": String(timestamp), "x-sabah-signature": signature }, now: timestamp, connector: inboundConnector(store(), sink, { allowedEvents: ["memory.proposed"] }) })).resolves.toMatchObject({ code: "event_not_allowed" });
    expect(sink).not.toHaveBeenCalled();
  });
  it("rejects an oversized inbound body before parsing", async () => {
    await expect(verifyInboundWebhook({ body: "x".repeat(65 * 1024), headers: {}, connector: inboundConnector(store(), () => undefined) })).resolves.toMatchObject({ code: "body_too_large" });
  });
  it("rejects restricted and secret-key payloads before replay claim or suggestion sink", async () => {
    const s = store(); const sink = vi.fn(); const timestamp = 1700000000;
    const payload = { event: "step.completed", eventId: "evt-restricted", payload: { classification: "restricted", apiKey: "do-not-store" } };
    const body = JSON.stringify(payload); const signature = `sha256=${createHmac("sha256", "secret").update(`${timestamp}.${body}`).digest("hex")}`;
    await expect(verifyInboundWebhook({ body, headers: { "x-sabah-timestamp": String(timestamp), "x-sabah-signature": signature }, now: timestamp, connector: inboundConnector(s, sink) })).resolves.toEqual({ code: "invalid_payload" });
    expect(s.claims).toHaveLength(0); expect(sink).not.toHaveBeenCalled();
  });
  it("releases an inbound replay claim when the sink fails so a signed retry can succeed", async () => {
    const s = store(); const timestamp = 1700000000; let fail = true;
    const sink = vi.fn(async () => { if (fail) throw new Error("temporary sink failure"); });
    const body = JSON.stringify({ event: "step.completed", eventId: "evt-retry", payload: { safe: true } });
    const signature = () => `sha256=${createHmac("sha256", "secret").update(`${timestamp}.${body}`).digest("hex")}`;
    await expect(verifyInboundWebhook({ body, headers: { "x-sabah-timestamp": String(timestamp), "x-sabah-signature": signature() }, now: timestamp, connector: inboundConnector(s, sink) })).resolves.toMatchObject({ code: "unavailable" });
    expect(s.claims).toHaveLength(0);
    fail = false;
    await expect(verifyInboundWebhook({ body, headers: { "x-sabah-timestamp": String(timestamp), "x-sabah-signature": signature() }, now: timestamp, connector: inboundConnector(s, sink) })).resolves.toMatchObject({ code: "accepted" });
  });
});
