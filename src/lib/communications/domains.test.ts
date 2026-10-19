import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredInternalDomains, parseInternalDomains } from "@/lib/communications/domains";

afterEach(() => vi.unstubAllEnvs());

describe("deployment-owned communication domains", () => {
    it("does not implicitly trust the original organization's email domain", () => {
        vi.stubEnv("COMMUNICATION_INTERNAL_DOMAINS", "");
        expect(configuredInternalDomains()).toEqual([]);
    });

    it("normalizes and deduplicates explicitly configured domains", () => {
        expect(parseInternalDomains("Example.com, team.example.org; EXAMPLE.COM")).toEqual(["example.com", "team.example.org"]);
    });

    it("rejects addresses, URLs and wildcard policies instead of expanding trust", () => {
        expect(parseInternalDomains("person@example.com, https://example.com, *.example.com, @example.com, localhost")).toEqual([]);
    });

    it("reads the deployment configuration at request time", () => {
        vi.stubEnv("COMMUNICATION_INTERNAL_DOMAINS", "first.example");
        expect(configuredInternalDomains()).toEqual(["first.example"]);
        vi.stubEnv("COMMUNICATION_INTERNAL_DOMAINS", "second.example");
        expect(configuredInternalDomains()).toEqual(["second.example"]);
    });
});
