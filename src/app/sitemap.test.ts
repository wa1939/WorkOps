import { describe, expect, it } from "vitest";
import sitemap from "./sitemap";

describe("sitemap", () => {
    it("is empty when no base URL is configured (no placeholder or leaked domains)", () => {
        delete process.env.APP_BASE_URL;
        delete process.env.NEXTAUTH_URL;
        expect(sitemap()).toEqual([]);
    });

    it("indexes only the public root when a base URL is configured", () => {
        process.env.APP_BASE_URL = "https://workops.example.org";
        try {
            const entries = sitemap();
            expect(entries).toHaveLength(1);
            expect(entries[0].url).toBe("https://workops.example.org/");
            expect(entries[0].changeFrequency).toBe("weekly");
            expect(entries[0].priority).toBe(1);
            // A request timestamp is not the page's content-modification date.
            expect(entries[0]).not.toHaveProperty("lastModified");
        } finally {
            delete process.env.APP_BASE_URL;
        }
    });

    it("normalizes trailing slashes on the configured base URL", () => {
        process.env.NEXTAUTH_URL = "https://hub.example.com/";
        try {
            expect(sitemap()[0].url).toBe("https://hub.example.com/");
        } finally {
            delete process.env.NEXTAUTH_URL;
        }
    });
});
