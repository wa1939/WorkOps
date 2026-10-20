import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { brand } from "@/lib/brand";
import { LandingCapabilities } from "./landing-capabilities";
import { LandingPlatform } from "./landing-platform";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("public product representation", () => {
    it("names task, project and workload management in descriptive search copy", () => {
        expect(brand.description).toMatch(/task/i);
        expect(brand.description).toMatch(/project/i);
        expect(brand.description).toMatch(/workload/i);
        expect(brand.description).toMatch(/capacity/i);
        expect(brand.description.length).toBeLessThanOrEqual(170);
    });

    it("explains capacity, time, handovers, PMO, custom views and optional providers", () => {
        const html = renderToStaticMarkup(<LandingCapabilities />);
        for (const term of ["Workload", "capacity", "Time tracking", "Leave", "PMO", "Custom views", "OpenAI", "Claude", "Nuha"]) {
            expect(html).toContain(term);
        }
        expect(html).toContain("configuration");
    });

    it("publishes current platform and role facts without implying optional services are bundled", () => {
        const html = renderToStaticMarkup(<LandingPlatform />);
        expect(html).not.toContain("Next.js 14");
        expect(html).toContain("Next.js 15");
        expect(html).toMatch(/manager/i);
        expect(html).toMatch(/viewer/i);
        expect(html).toMatch(/optional/i);
    });
});
