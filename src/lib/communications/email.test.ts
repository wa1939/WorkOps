import { expect, it } from "vitest";
import { buildEmailSender } from "./email";

const delivery = {
    id: "delivery-1",
    channel: "email",
    destinationKey: "member@example.test",
};

const event = {
    id: "event-1",
    category: "task",
    sourceType: "task",
    sourceId: "task-1",
};

it("returned provider error is failed", async () => {
    const sender = buildEmailSender({
        send: async () => ({ data: null, error: { message: "Rejected" } }),
    });

    await expect(sender(delivery, event)).resolves.toEqual({
        outcome: "failed",
        message: "Rejected",
        retryable: true,
    });
});

it("accepted requires provider id", async () => {
    const sender = buildEmailSender({
        send: async () => ({ data: {} }),
    });

    const outcome = await sender(delivery, event);

    expect(outcome.outcome).not.toBe("accepted");
});

it("accepted carries provider id", async () => {
    const sender = buildEmailSender({
        send: async () => ({ data: { id: "provider-1" }, error: null }),
    });

    await expect(sender(delivery, event)).resolves.toEqual({
        outcome: "accepted",
        providerId: "provider-1",
    });
});
