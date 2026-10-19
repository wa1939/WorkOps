import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    findFirst: vi.fn(),
    createDelivery: vi.fn(),
    updateDeliveries: vi.fn(),
    decrypt: vi.fn(),
    resolveStoredVersion: vi.fn(),
    registerBuiltins: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { aiConnector: { findFirst: mocks.findFirst }, aiWebhookDelivery: { create: mocks.createDelivery, updateMany: mocks.updateDeliveries } } }));
vi.mock("@/lib/sabah/connectors/crypto", () => ({ decryptConnectorCredential: mocks.decrypt }));
vi.mock("@/lib/sabah/connectors/registry", () => ({ connectorRegistry: { resolveStoredVersion: mocks.resolveStoredVersion } }));
vi.mock("@/lib/sabah/connectors/builtins", () => ({ registerBuiltinConnectors: mocks.registerBuiltins }));

import { getWebhookRuntime } from "./runtime";

describe("local webhook runtime", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.SABAH_PLAN10_LOCAL_RUNTIME = "1";
        process.env.SABAH_PLAN10_CONTROL_PORT = "4010";
        process.env.SABAH_CREDENTIAL_KEY = "test-local-credential-key";
        mocks.findFirst.mockResolvedValue({
            id: "connector-1",
            key: "sabah.webhook",
            version: 1,
            direction: "BIDIRECTIONAL",
            enabled: true,
            eventType: "step.completed",
            credential: { encryptedValue: "encrypted", iv: "iv", authTag: "tag", keyVersion: 1 },
        });
        mocks.resolveStoredVersion.mockReturnValue({ key: "sabah.webhook", storedVersion: 1, supportedEvents: ["step.completed"] });
        mocks.decrypt.mockReturnValue("local-credential");
        mocks.createDelivery.mockResolvedValue({});
        mocks.updateDeliveries.mockResolvedValue({ count: 1 });
    });
    afterEach(() => { delete process.env.SABAH_PLAN10_LOCAL_RUNTIME; delete process.env.SABAH_PLAN10_CONTROL_PORT; delete process.env.SABAH_CREDENTIAL_KEY; vi.unstubAllGlobals(); });

    it("resolves the persisted connector and forwards only a safe inbound projection", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const runtime = getWebhookRuntime();
        if (!runtime) throw new Error("local runtime was unavailable");
        const connector = await runtime.resolveConnector("sabah.webhook");
        if (!connector) throw new Error("connector was unavailable");
        expect(connector.secret).toBe("local-credential");
        expect(await connector.store.claimReplay("event-1")).toBe(true);
        await connector.suggestionSink({ connectorKey: "sabah.webhook", eventId: "event-1", event: "step.completed", payload: { secret: "must-not-forward" } });
        expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4010/connector/inbound", expect.objectContaining({ method: "POST" }));
        const request = fetchMock.mock.calls[0]?.[1];
        if (!request || typeof request.body !== "string") throw new Error("safe sink request was missing");
        expect(request.body).not.toContain("must-not-forward");
    });

    it("reopens only a released pending replay claim", async () => {
        const runtime = getWebhookRuntime();
        if (!runtime) throw new Error("local runtime was unavailable");
        const connector = await runtime.resolveConnector("sabah.webhook");
        if (!connector) throw new Error("connector was unavailable");
        expect(await connector.store.claimReplay("event-retry")).toBe(true);
        await connector.store.releaseReplay("event-retry");
        mocks.createDelivery.mockRejectedValueOnce(new Error("duplicate replay"));
        expect(await connector.store.claimReplay("event-retry")).toBe(true);
        expect(mocks.updateDeliveries).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "RETRY_WAIT" }) }));
    });
});
