import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    createMany: vi.fn(),
    upsert: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        notificationPreference: {
            findMany: mocks.findMany,
            findUnique: mocks.findUnique,
            createMany: mocks.createMany,
            upsert: mocks.upsert,
        },
    },
}));

import { GET, PUT } from "./route";

const session = { user: { id: "user-a", role: "MEMBER", departmentIds: [] } };
const request = (body: unknown) => new Request("http://localhost/api/notifications/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
});

describe("/api/notifications/preferences", () => {
    it("creates default preferences lazily", async () => {
        const defaults = [
            { id: "pref-task", userId: "user-a", category: "task", emailEnabled: true, inAppEnabled: true, pushEnabled: false, quietEnabled: false, quietStartMinute: null, quietEndMinute: null, timezone: "Asia/Riyadh" },
            { id: "pref-digest", userId: "user-a", category: "digest", emailEnabled: true, inAppEnabled: true, pushEnabled: false, quietEnabled: false, quietStartMinute: null, quietEndMinute: null, timezone: "Asia/Riyadh" },
            { id: "pref-security", userId: "user-a", category: "account_security", emailEnabled: true, inAppEnabled: true, pushEnabled: false, quietEnabled: false, quietStartMinute: null, quietEndMinute: null, timezone: "Asia/Riyadh" },
        ];
        mocks.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(defaults);
        mocks.createMany.mockResolvedValue({ count: defaults.length });

        const response = await GET();

        expect(response.status).toBe(200);
        expect(mocks.createMany).toHaveBeenCalledWith({
            data: expect.arrayContaining([
                expect.objectContaining({ userId: "user-a", category: "task", pushEnabled: false }),
                expect.objectContaining({ userId: "user-a", category: "digest", pushEnabled: false }),
                expect.objectContaining({ userId: "user-a", category: "account_security", emailEnabled: true, pushEnabled: false }),
            ]),
            skipDuplicates: true,
        });
        expect(await response.json()).toEqual({ preferences: defaults });
    });

    it("rejects disabling account security email", async () => {
        const response = await PUT(request({
            userId: "user-b",
            category: "account_security",
            emailEnabled: false,
            inAppEnabled: true,
            pushEnabled: false,
            quietEnabled: false,
            timezone: "Asia/Riyadh",
        }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: expect.stringMatching(/account security/i) });
        expect(mocks.upsert).not.toHaveBeenCalled();
    });
});
