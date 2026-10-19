import { describe, expect, it } from "vitest";
import { LifecycleEventBus, type EventPersistence } from "./bus";
import type { SabahLifecycleEvent } from "./contracts";

const source = { entityType: "PROJECT" as const, entityId: "p-1", label: "Project", href: "/projects/p-1", sourceUpdatedAt: "2026-08-30T00:00:00.000Z", checksum: "abc123" };
const event = (payload: unknown = { message: "hello", token: "secret" }): Omit<SabahLifecycleEvent, "id" | "occurredAt"> => ({ name: "memory.proposed", correlationId: "corr-1", actorId: "actor-1", entityRefs: [source], payload });

class FakePersistence implements EventPersistence {
  readonly events: SabahLifecycleEvent[] = [];
  async persist(value: SabahLifecycleEvent): Promise<void> { this.events.push(value); }
}

describe("LifecycleEventBus", () => {
  it("creates a bounded, redacted, deeply immutable envelope", async () => {
    const persistence = new FakePersistence();
    const bus = new LifecycleEventBus({ persistence });
    const published = (await bus.publish(event({ token: "do-not-store", nested: { value: "x" } }))).event;
    expect(published.payload).toEqual({ token: "[REDACTED]", nested: { value: "x" } });
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.entityRefs)).toBe(true);
    expect(Object.isFrozen(published.payload)).toBe(true);
    expect(() => { (published.payload as { nested: { value: string } }).nested.value = "changed"; }).toThrow();
    expect(persistence.events[0]).toBe(published);
  });

  it("persists before handlers and isolates handler failures", async () => {
    const persistence = new FakePersistence();
    const order: string[] = [];
    const bus = new LifecycleEventBus({ persistence, handlers: [async () => { order.push("handler"); throw new Error("isolated"); }] });
    const result = await bus.publish(event());
    expect(order).toEqual(["handler"]);
    expect(persistence.events).toHaveLength(1);
    expect(result.handlerFailures).toHaveLength(1);
    expect(result.event).toBe(persistence.events[0]);
  });

  it("persists only allowlisted source reference fields", async () => {
    const persistence = new FakePersistence();
    const bus = new LifecycleEventBus({ persistence });
    const sourceWithSecret = { ...source, secret: "do-not-persist" };
    const published = (await bus.publish({ ...event(), entityRefs: [sourceWithSecret] })).event;
    expect(published.entityRefs[0]).toEqual(source);
    expect(Object.prototype.hasOwnProperty.call(published.entityRefs[0], "secret")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(persistence.events[0].entityRefs[0], "secret")).toBe(false);
  });

  it("rejects unsupported names and oversized source references", async () => {
    const bus = new LifecycleEventBus({ persistence: new FakePersistence() });
    await expect(bus.publish({ ...event(), name: "unknown.event" as SabahLifecycleEvent["name"] })).rejects.toThrow();
    await expect(bus.publish({ ...event(), entityRefs: [{ ...source, label: "x".repeat(201) }] })).rejects.toThrow();
  });

  it("rejects caller-supplied invalid identity and timestamps", async () => {
    const bus = new LifecycleEventBus({ persistence: new FakePersistence() });
    await expect(bus.publish({ ...event(), id: "bad id" })).rejects.toThrow();
    await expect(bus.publish({ ...event(), occurredAt: "2026-08-30" })).rejects.toThrow();
    await expect(bus.publish({ ...event(), occurredAt: new Date(Date.now() + 3_600_001).toISOString() })).rejects.toThrow();
  });

  it("rejects unsafe and malformed source references", async () => {
    const bus = new LifecycleEventBus({ persistence: new FakePersistence() });
    for (const href of ["javascript:alert(1)", "data:text/html,x", "https://example.test", "projects/p-1"]) {
      await expect(bus.publish({ ...event(), entityRefs: [{ ...source, href }] })).rejects.toThrow();
    }
    const malformed = { ...source };
    Object.defineProperty(malformed, "entityType", { value: "UNKNOWN" });
    await expect(bus.publish({ ...event(), entityRefs: [malformed] })).rejects.toThrow();
    await expect(bus.publish({ ...event(), entityRefs: [{ ...source, sourceUpdatedAt: "not-a-date" }] })).rejects.toThrow();
  });
});
