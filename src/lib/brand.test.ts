import { describe, expect, it } from "vitest";
import { brand, getOptionalSiteUrl, getSiteUrl } from "./brand";

describe("getOptionalSiteUrl", () => {
    it("prefers APP_BASE_URL over NEXTAUTH_URL", () => {
        expect(
            getOptionalSiteUrl({
                APP_BASE_URL: "https://workops.example.org",
                NEXTAUTH_URL: "https://other.example.com",
            }),
        ).toBe("https://workops.example.org");
    });

    it("falls back to NEXTAUTH_URL when APP_BASE_URL is unset", () => {
        expect(getOptionalSiteUrl({ NEXTAUTH_URL: "https://hub.example.com" })).toBe(
            "https://hub.example.com",
        );
    });

    it("strips trailing slashes and surrounding whitespace", () => {
        expect(
            getOptionalSiteUrl({ APP_BASE_URL: "  https://workops.example.org///  " }),
        ).toBe("https://workops.example.org");
    });

    it("returns null when unset or blank so callers can omit canonical metadata", () => {
        expect(getOptionalSiteUrl({})).toBeNull();
        expect(getOptionalSiteUrl({ APP_BASE_URL: "   " })).toBeNull();
        expect(getOptionalSiteUrl({ NEXTAUTH_URL: "" })).toBeNull();
    });
});

describe("getSiteUrl", () => {
    it("falls back to localhost for local metadata resolution", () => {
        expect(getSiteUrl({})).toBe("http://localhost:3000");
    });

    it("uses the configured base URL when present", () => {
        expect(getSiteUrl({ APP_BASE_URL: "https://workops.example.org" })).toBe(
            "https://workops.example.org",
        );
    });
});

describe("brand", () => {
    it("identifies the product as WorkOps", () => {
        expect(brand.name).toBe("WorkOps");
    });

    it("links the public WorkOps repository", () => {
        expect(brand.repository.url).toBe("https://github.com/wa1939/WorkOps");
        expect(brand.repository.owner).toBe("wa1939");
        expect(brand.repository.repo).toBe("WorkOps");
    });

    it("is MIT licensed by the maintainer", () => {
        expect(brand.license.name).toBe("MIT");
        expect(brand.author.name).toBe("Waleed Alhamed");
    });
});
