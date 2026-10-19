import { describe, expect, it } from "vitest";
import { validateModelAssetVersion } from "./publish-sabah-model-assets";

describe("Sabah model asset publisher version validation", () => {
    it.each([undefined, "", "   "])("fails closed when the reviewed upstream version is absent or blank", (version) => {
        expect(() => validateModelAssetVersion(version)).toThrow(/SABAH_MODEL_ASSET_VERSION/);
    });

    it("preserves a valid reviewed upstream version", () => {
        expect(validateModelAssetVersion("v1.2.3-ara")).toBe("v1.2.3-ara");
    });

    it("rejects an unbounded or ambiguous version format", () => {
        expect(() => validateModelAssetVersion("../latest")).toThrow(/unsupported format/);
    });
});
