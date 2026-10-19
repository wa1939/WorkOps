import { expect, it } from "vitest";
import { canTransition, type DeliveryState } from "./contracts";

it("pending dispatches through sending", () => {
  expect(canTransition("PENDING", "SENDING")).toBe(true);
  expect(canTransition("PENDING", "DELIVERED")).toBe(false);
});

it("terminal states cannot be downgraded", () => {
  expect(canTransition("DELIVERED", "ACCEPTED")).toBe(false);
  expect(canTransition("BOUNCED", "SENDING")).toBe(false);
  expect(canTransition("DELIVERED", "DELIVERED")).toBe(false);
  expect(canTransition("EXPIRED", "PENDING")).toBe(false);
});

it("failed re-arms for retry but delivered never does", () => {
  expect(canTransition("FAILED", "PENDING")).toBe(true);
  expect(canTransition("FAILED", "DELIVERED")).toBe(false);
});

it("sending lease recovery returns to pending", () => {
  expect(canTransition("SENDING", "PENDING")).toBe(true);
});

it("unknown states are rejected not thrown", () => {
  expect(canTransition("MAYBE" as DeliveryState, "PENDING")).toBe(false);
});
