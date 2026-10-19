import { describe, expect, it } from "vitest";
import { isApprovedPushEndpoint } from "./endpoint-guard";

describe("push endpoint allowlist", () => {
    it("private network endpoint rejected", () => {
        const rejected = [
            "http://fcm.googleapis.com/fcm/send/test",
            "https://localhost/push",
            "https://localhost:8443/push",
            "https://10.0.0.7/push",
            "https://192.168.1.10/push",
            "https://127.0.0.1/push",
            "https://[::1]/push",
            "https://8.8.8.8/push",
            "https://unknown-push-service.example/push",
            "https://fcm.googleapis.com.evil.example/push",
        ];

        for (const endpoint of rejected) {
            expect(isApprovedPushEndpoint(endpoint), endpoint).toBe(false);
        }
    });

    it("approved push services accepted", () => {
        const approved = [
            "https://fcm.googleapis.com/fcm/send/test",
            "https://updates.push.services.mozilla.com/wpush/v2/test",
            "https://web.push.apple.com/3/device/test",
        ];

        for (const endpoint of approved) {
            expect(isApprovedPushEndpoint(endpoint), endpoint).toBe(true);
        }
    });
});
