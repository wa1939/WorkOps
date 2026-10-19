import { afterEach, describe, expect, it, vi } from "vitest";
import { getSabahFlags, parseSabahFlags } from "./flags";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("parseSabahFlags", () => {
    it("defaults all production writes to disabled", () => {
        expect(parseSabahFlags({})).toMatchObject({
            platform: false,
            writes: false,
            memory: false,
            multimodal: false,
            monitors: false,
        });
    });

    it("enables a flag only when its value is the literal true string", () => {
        expect(parseSabahFlags({
            SABAH_PLATFORM_ENABLED: "true",
            SABAH_WRITES_ENABLED: "TRUE",
            SABAH_MEMORY_ENABLED: "1",
            SABAH_MULTIMODAL_ENABLED: " true ",
            SABAH_MONITORS_ENABLED: "false",
        })).toEqual({
            platform: true,
            writes: false,
            memory: false,
            multimodal: false,
            monitors: false,
        });
    });
});

describe("getSabahFlags", () => {
    it("reads the Sabah flags from process.env", () => {
        vi.stubEnv("SABAH_PLATFORM_ENABLED", "true");
        vi.stubEnv("SABAH_WRITES_ENABLED", "true");
        vi.stubEnv("SABAH_MEMORY_ENABLED", "false");
        vi.stubEnv("SABAH_MULTIMODAL_ENABLED", "1");
        vi.stubEnv("SABAH_MONITORS_ENABLED", "true");

        expect(getSabahFlags()).toEqual({
            platform: true,
            writes: true,
            memory: false,
            multimodal: false,
            monitors: true,
        });
    });
});
