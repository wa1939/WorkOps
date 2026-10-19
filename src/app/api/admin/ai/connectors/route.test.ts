import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const state: { registeredDefinition?: unknown } = {};
  return { auth: vi.fn(), prisma: { aiConnector: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn(), update: vi.fn() }, aiConnectorCredential: { upsert: vi.fn() }, user: { findUnique: vi.fn() } }, encrypt: vi.fn(), state, registry: { register: vi.fn((definition: unknown) => { state.registeredDefinition = definition; }), resolve: vi.fn(), resolveStoredVersion: vi.fn() } };
});
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/sabah/connectors/crypto", () => ({ encryptConnectorCredential: mocks.encrypt }));
vi.mock("@/lib/sabah/connectors/registry", () => ({ isValidConnectorKey: (key: unknown) => typeof key === "string" && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,62}$/.test(key), connectorRegistry: mocks.registry }));

import { GET, POST } from "./route";
import { setConnectorRuntime } from "./connector-runtime";

const request = (body: unknown) => new Request("https://app.example/api/admin/ai/connectors", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const validInput = { key: "acme.tasks", version: 1, kind: "webhook", direction: "OUTBOUND", eventType: "step.completed", capability: "tasks.read", dataPolicy: "internal", config: {}, enabled: true };

describe("admin connector route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConnectorRuntime({});
    // Persisted authorization: role comes from the database record, not the JWT.
    mocks.prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, role: where.id === "admin" ? "ADMIN" : "MEMBER", isActive: true, departments: [] }));
  });
  afterEach(() => { delete process.env.SABAH_PLAN10_LOCAL_RUNTIME; delete process.env.SABAH_PLAN10_CONTROL_PORT; vi.unstubAllGlobals(); });
  it("fails closed for unauthenticated and non-admin requests", async () => {
    mocks.auth.mockResolvedValueOnce(null).mockResolvedValueOnce({ user: { id: "u1", role: "MEMBER" } });
    expect((await GET(new Request("https://app.example/api/admin/ai/connectors"))).status).toBe(401);
    expect((await GET(new Request("https://app.example/api/admin/ai/connectors"))).status).toBe(403);
  });

  it("rejects a stale admin JWT when the persisted role was demoted", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "demoted", role: "ADMIN" } });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "demoted", role: "MEMBER", isActive: true, departments: [] });
    expect((await GET(new Request("https://app.example/api/admin/ai/connectors"))).status).toBe(403);
    expect((await POST(request({ action: "enable", id: "c1" }))).status).toBe(403);
    expect(mocks.prisma.aiConnector.update).not.toHaveBeenCalled();
  });

  it("rejects a deactivated account regardless of JWT role", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "admin", role: "ADMIN", isActive: false, departments: [] });
    expect((await GET(new Request("https://app.example/api/admin/ai/connectors"))).status).toBe(403);
  });

  it("masks credentials and rejects arbitrary URLs/events", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    setConnectorRuntime({ masterKey: Buffer.alloc(32, 1).toString("base64") });
    mocks.prisma.aiConnector.findMany.mockResolvedValue([{ id: "c1", key: "acme.tasks", version: 1, kind: "webhook", direction: "OUTBOUND", enabled: true, eventType: "step.completed", capability: "tasks.read", dataPolicy: "internal", configJson: '{"apiToken":"hidden"}', credential: { encryptedValue: "cipher", iv: "iv", authTag: "tag", keyVersion: 1 } }]);
    const response = await GET(new Request("https://app.example/api/admin/ai/connectors"));
    const body = await response.json();
    expect(body.connectors[0].credential).toBe("configured");
    expect(body.connectors[0].config).toEqual({});
    expect(JSON.stringify(body)).not.toContain("cipher");
    expect(JSON.stringify(body)).not.toContain("hidden");
    expect((await POST(request({ key: "acme.tasks", version: 1, kind: "webhook", direction: "OUTBOUND", eventType: "nope", capability: "tasks.read", dataPolicy: "internal", config: {}, endpoint: "https://evil.test" }))).status).toBe(400);
    expect((await POST(request({ key: "acme.tasks", version: 1, kind: "webhook", direction: "OUTBOUND", eventType: "step.completed", capability: "tasks.read", dataPolicy: "internal", config: { apiToken: "hidden" } }))).status).toBe(400);
  });

  it("returns unavailable instead of claiming delivery when no signed transport is injected", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    const response = await POST(request({ key: "acme.tasks", version: 1, kind: "webhook", direction: "OUTBOUND", eventType: "step.completed", capability: "tasks.read", dataPolicy: "internal", config: {}, enabled: true }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(expect.objectContaining({ code: "unavailable" }));
  });

  it("does not assert malformed registry metadata into a verified definition", async () => {
    const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
    expect(source).not.toContain("as VerifiedConnectorDefinition");
  });

  it("uses the production registry resolver when no test override is installed", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    mocks.registry.resolveStoredVersion.mockReturnValue({ key: "acme.tasks", version: "1.0.0", storedVersion: 1, kind: "webhook", direction: "OUTBOUND", supportedEvents: ["step.completed"], supportedCapabilities: ["tasks.read"], configSchema: { safeParse: () => ({ success: true, data: {} }) }, credentialSchema: { safeParse: () => ({ success: true, data: {} }) }, dataClassification: "INTERNAL", dataPolicy: "verified", enabled: true });
    mocks.prisma.aiConnector.upsert.mockResolvedValue({ id: "c1", ...validInput, configJson: "{}", createdAt: new Date(), updatedAt: new Date() });
    mocks.prisma.aiConnector.findUnique.mockResolvedValue({ id: "c1", ...validInput, configJson: "{}", credential: null, createdAt: new Date(), updatedAt: new Date() });
    const response = await POST(request(validInput));
    expect(response.status).toBe(201);
    expect(mocks.registry.resolveStoredVersion).toHaveBeenCalledWith("acme.tasks", 1);
  });

  it("persists a valid built-in webhook through the default resolver", async () => {
    process.env.SABAH_WEBHOOK_ALLOWED_HOSTS = "hooks.example.test";
    mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    const registered = mocks.state.registeredDefinition;
    mocks.registry.resolveStoredVersion.mockReturnValue(registered);
    mocks.prisma.aiConnector.upsert.mockResolvedValue({ id: "c1", key: "sabah.webhook", version: 1, kind: "webhook", direction: "BIDIRECTIONAL", enabled: true, eventType: "step.completed", capability: "tasks.create", dataPolicy: "INTERNAL", configJson: '{"host":"hooks.example.test","path":"/sabah"}', credential: null, createdAt: new Date(), updatedAt: new Date() });
    mocks.prisma.aiConnector.findUnique.mockResolvedValue({ id: "c1", key: "sabah.webhook", version: 1, kind: "webhook", direction: "BIDIRECTIONAL", enabled: true, eventType: "step.completed", capability: "tasks.create", dataPolicy: "INTERNAL", configJson: '{"host":"hooks.example.test","path":"/sabah"}', credential: null, createdAt: new Date(), updatedAt: new Date() });
    const response = await POST(request({ key: "sabah.webhook", version: 1, kind: "webhook", direction: "BIDIRECTIONAL", eventType: "step.completed", capability: "tasks.create", dataPolicy: "INTERNAL", config: { host: "hooks.example.test", path: "/sabah" }, enabled: true }));
    expect(response.status).toBe(201);
    expect(mocks.prisma.aiConnector.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key_version: { key: "sabah.webhook", version: 1 } } }));
  });

  it("requires exact stored version equality before persistence", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    mocks.registry.resolveStoredVersion.mockReturnValue({ key: "acme.tasks", version: "1.0.0", storedVersion: 2, kind: "webhook", direction: "OUTBOUND", supportedEvents: ["step.completed"], supportedCapabilities: ["tasks.read"], configSchema: { safeParse: () => ({ success: true, data: {} }) }, credentialSchema: { safeParse: () => ({ success: true, data: {} }) }, dataClassification: "INTERNAL", dataPolicy: "verified", enabled: true });
    expect((await POST(request(validInput))).status).toBe(503);
    expect(mocks.prisma.aiConnector.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON without touching persistence", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    const response = await POST(new Request("https://app.example/api/admin/ai/connectors", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(mocks.prisma.aiConnector.upsert).not.toHaveBeenCalled();
  });

  it("strips connectorKey from encrypted credential persistence payload", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    mocks.encrypt.mockReturnValue({ encryptedValue: "enc", iv: "iviviviviviviviv", authTag: "tagtagtagtagtagtag", keyVersion: 1, connectorKey: "acme.tasks" });
    mocks.prisma.aiConnector.upsert.mockResolvedValue({ id: "c1", ...validInput, configJson: "{}", createdAt: new Date(), updatedAt: new Date() });
    mocks.prisma.aiConnector.findUnique.mockResolvedValue({ id: "c1", ...validInput, configJson: "{}", credential: { id: "cred" }, createdAt: new Date(), updatedAt: new Date() });
    setConnectorRuntime({ masterKey: "test", resolveConnector: vi.fn().mockResolvedValue({ key: "acme.tasks", version: "1.0.0", storedVersion: 1, kind: "webhook", direction: "OUTBOUND", supportedEvents: ["step.completed"], supportedCapabilities: ["tasks.read"], configSchema: { safeParse: () => ({ success: true, data: {} }) }, credentialSchema: { safeParse: () => ({ success: true, data: {} }) }, dataClassification: "INTERNAL", dataPolicy: "verified", enabled: true }) });
    await POST(request({ ...validInput, credential: "secret" }));
    expect(mocks.prisma.aiConnectorCredential.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { encryptedValue: "enc", iv: "iviviviviviviviv", authTag: "tagtagtagtagtagtag", keyVersion: 1 } }));
    expect(mocks.prisma.aiConnectorCredential.upsert.mock.calls.at(-1)?.[0].update).not.toHaveProperty("connectorKey");
  });

  it("preserves the original request headers in the dynamic test route", async () => {
    mocks.auth.mockImplementation(async () => ({ user: { id: "admin", role: "ADMIN" } }));
    setConnectorRuntime({ testTransport: vi.fn().mockResolvedValue({ code: "delivered" }) });
    const { POST: testRoute } = await import("./[id]/test/route");
    const response = await testRoute(new Request("https://app.example/api/admin/ai/connectors/c1/test", { method: "POST", headers: { authorization: "Bearer original", cookie: "auth=original" } }), { params: Promise.resolve({ id: "c1" }) });
    expect(response.status).not.toBe(401);
  });

  it("uses the fixed loopback local test transport only when explicitly enabled", async () => {
    process.env.SABAH_PLAN10_LOCAL_RUNTIME = "1";
    process.env.SABAH_PLAN10_CONTROL_PORT = "4010";
    mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    mocks.prisma.aiConnector.findUnique.mockResolvedValue({ id: "c1", eventType: "step.completed", enabled: true, configJson: "{}" });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: "delivered" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST: testRoute } = await import("./[id]/test/route");
    const response = await testRoute(new Request("https://app.example/api/admin/ai/connectors/c1/test", { method: "POST" }), { params: Promise.resolve({ id: "c1" }) });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4010/connector/test", expect.objectContaining({ method: "POST" }));
  });
});
