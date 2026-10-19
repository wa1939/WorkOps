import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    findMany: vi.fn(), updateMany: vi.fn(), transaction: vi.fn(),
    call: vi.fn(), resolve: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
    task: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    $transaction: mocks.transaction,
} }));
vi.mock("@/lib/glm", () => ({ callGLMText: mocks.call }));
vi.mock("./provider-resolution", () => ({ resolveOperationalAiTarget: mocks.resolve }));
import { estimateMissingEfforts } from "./effort-estimate";
import { runBestEffortEffortEstimation } from "@/lib/team-load";

afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

function arrangeDeadline() {
    const controller = new AbortController();
    const deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    mocks.findMany.mockResolvedValue([{ id: "deadline-task", title: "Synthetic task", description: null, project: null }]);
    mocks.resolve.mockResolvedValue({ provider: "glm", model: "glm-5.3-flash", fallbacks: [], credentials: {} });
    mocks.call.mockImplementation(async (_prompt: string, options: { signal?: AbortSignal }) => {
        if (!options.signal) throw new Error("Missing estimation cancellation deadline");
        const pending = new Promise<never>((_resolve, reject) => {
            options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
        });
        controller.abort(new DOMException("Synthetic deadline reached", "TimeoutError"));
        return pending;
    });
    return { deadline, controller };
}

describe("effort estimation deadline", () => {
    it("cancels the provider chain within its budget and never stores a timed-out estimate", async () => {
        const { deadline, controller } = arrangeDeadline();
        await expect(estimateMissingEfforts()).rejects.toMatchObject({ name: "TimeoutError" });
        expect(deadline).toHaveBeenCalledWith(30_000);
        expect(mocks.call.mock.calls[0][1].signal).toBe(controller.signal);
        expect(mocks.call.mock.calls[0][1].thinking).toBe("disabled");
        expect(mocks.updateMany).not.toHaveBeenCalled();
        expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("returns an explicit skipped estimate so load calculations can continue after timeout", async () => {
        const { deadline } = arrangeDeadline();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        await expect(runBestEffortEffortEstimation()).resolves.toEqual({
            candidates: 0, estimated: 0, skipped: true, reason: "provider_unavailable",
        });
        expect(deadline).toHaveBeenCalledWith(30_000);
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
});
