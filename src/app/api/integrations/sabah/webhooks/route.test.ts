import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "./[connectorKey]/route";
import { setWebhookRuntimeForTests } from "./[connectorKey]/runtime";
import type { VerifiedInboundConnector } from "../../../../../lib/sabah/connectors/adapters/webhook";

afterEach(() => setWebhookRuntimeForTests(null));
const connector: VerifiedInboundConnector = { connectorKey: "acme", enabled: true, direction: "INBOUND", allowedEvents: ["step.completed"], secret: "secret", store: { claimReplay: async () => true, recordDelivery: async () => undefined, releaseReplay: async () => undefined }, suggestionSink: async () => undefined };

describe("Sabah webhook route", () => {
  it("does not export the test runtime setter from the route module", async () => {
    const route = await import("./[connectorKey]/route");
    expect(route).not.toHaveProperty("setWebhookRuntimeForTests");
  });

  it("fails closed when no verified runtime is configured", async () => {
    const response = await POST(new NextRequest("https://department.test/api/integrations/sabah/webhooks/acme"), { params: Promise.resolve({ connectorKey: "acme" }) });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "unavailable" });
  });
  it("verifies the resolved connector context instead of trusting a handler result", async () => {
    setWebhookRuntimeForTests({ resolveConnector: async () => connector });
    const body = JSON.stringify({ event: "step.completed", eventId: "evt-route", payload: {} }); const timestamp = Math.floor(Date.now() / 1000);
    const response = await POST(new NextRequest("https://department.test/api/integrations/sabah/webhooks/acme", { method: "POST", body, headers: { "x-sabah-timestamp": String(timestamp), "x-sabah-signature": `sha256=${createHmac("sha256", "secret").update(`${timestamp}.${body}`).digest("hex")}` } }), { params: Promise.resolve({ connectorKey: "acme" }) });
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ ok: true, code: "accepted" });
  });
  it("rejects a valid-looking request without a signature", async () => {
    setWebhookRuntimeForTests({ resolveConnector: async () => connector });
    const response = await POST(new NextRequest("https://department.test/api/integrations/sabah/webhooks/acme", { method: "POST", body: JSON.stringify({ event: "step.completed", eventId: "evt-forged" }), headers: { "x-sabah-timestamp": "1700000000" } }), { params: Promise.resolve({ connectorKey: "acme" }) });
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, code: "invalid_timestamp" });
  });
  it("rejects disabled and outbound-only resolved connectors", async () => {
    for (const resolved of [{ ...connector, enabled: false }, { ...connector, direction: "OUTBOUND" as const }]) {
      setWebhookRuntimeForTests({ resolveConnector: async () => resolved });
      const response = await POST(new NextRequest("https://department.test/api/integrations/sabah/webhooks/acme"), { params: Promise.resolve({ connectorKey: "acme" }) });
      expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "unavailable" });
    }
  });
  it("caps raw request bytes before resolving or verifying", async () => {
    let resolved = false;
    setWebhookRuntimeForTests({ resolveConnector: async () => { resolved = true; return connector; } });
    const response = await POST(new NextRequest("https://department.test/api/integrations/sabah/webhooks/acme", { method: "POST", body: "x".repeat(65 * 1024) }), { params: Promise.resolve({ connectorKey: "acme" }) });
    expect(response.status).toBe(413); expect(await response.json()).toEqual({ ok: false, code: "body_too_large" }); expect(resolved).toBe(false);
  });
});
