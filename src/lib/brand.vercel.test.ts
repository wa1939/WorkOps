import { describe, expect, it } from "vitest";
import { getOptionalSiteUrl } from "./brand";

describe("Vercel canonical origin", () => {
    it("uses the real production alias rather than inventing a localhost canonical", () => {
        expect(getOptionalSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "workops.example", VERCEL_ENV: "production" })).toBe("https://workops.example");
    });
    it("keeps the explicitly configured public origin authoritative", () => {
        expect(getOptionalSiteUrl({ APP_BASE_URL: "https://team.example", VERCEL_PROJECT_PRODUCTION_URL: "workops.example" })).toBe("https://team.example");
    });
});
