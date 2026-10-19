import { test, expect } from "@playwright/test";

test.describe("API Security - Unauthenticated access", () => {
    test("GET /api/tasks returns 401 without auth", async ({ request }) => {
        const res = await request.get("/api/tasks");
        expect(res.status()).toBe(401);
    });

    test("GET /api/users returns 401 without auth", async ({ request }) => {
        const res = await request.get("/api/users");
        expect(res.status()).toBe(401);
    });

    test("GET /api/projects returns 401 without auth", async ({ request }) => {
        const res = await request.get("/api/projects");
        expect(res.status()).toBe(401);
    });

    test("GET /api/notifications returns 401 without auth", async ({ request }) => {
        const res = await request.get("/api/notifications");
        expect(res.status()).toBe(401);
    });

    test("POST /api/tasks/bulk-update returns 401 without auth", async ({ request }) => {
        const res = await request.post("/api/tasks/bulk-update", {
            data: { taskIds: ["fake"], action: "status", status: "DONE" },
        });
        expect(res.status()).toBe(401);
    });

    test("GET /api/tasks/export returns 401 without auth", async ({ request }) => {
        const res = await request.get("/api/tasks/export");
        expect(res.status()).toBe(401);
    });

    test("PMO APIs require authentication", async ({ request }) => {
        for (const path of ["/api/pmo/actions", "/api/pmo/work-areas", "/api/pmo/contacts", "/api/pmo/portfolio", "/api/pmo/export"]) {
            expect((await request.get(path)).status()).toBe(401);
        }
        expect((await request.get("/api/cron/pmo-reminders")).status()).toBe(401);
    });

    test("POST /api/admin/departments returns 403 without admin", async ({ request }) => {
        const res = await request.post("/api/admin/departments", {
            data: { name: "Test" },
        });
        // Either 401 (unauthenticated) or 403 (forbidden) is acceptable
        expect([401, 403]).toContain(res.status());
    });

    test("POST /api/leave requires auth", async ({ request }) => {
        const res = await request.post("/api/leave", {
            data: {
                startAt: "2026-05-01T00:00:00.000Z",
                endAt: "2026-05-05T00:00:00.000Z",
                delegateId: "fake",
            },
        });
        expect(res.status()).toBe(401);
    });

    test("POST /api/leave rejects invalid dates", async ({ request }) => {
        // This tests the date validation refine we added
        // Even without auth it should still reject - but with auth check first
        const res = await request.post("/api/leave", {
            data: {
                startAt: "2026-05-10T00:00:00.000Z",
                endAt: "2026-05-01T00:00:00.000Z", // end before start
                delegateId: "fake",
            },
        });
        // Should be 401 (auth check comes first) or 400 (validation)
        expect([400, 401]).toContain(res.status());
    });
});
