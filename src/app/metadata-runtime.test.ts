import { describe, expect, it } from "vitest";
import * as robots from "./robots";
import * as sitemap from "./sitemap";

describe("runtime deployment metadata", () => {
    it.each([["robots", robots], ["sitemap", sitemap]])("keeps %s dynamic so a reusable image uses runtime canonical and preview settings", (_name, route) => {
        expect(route).toHaveProperty("dynamic", "force-dynamic");
    });
});
