export type SabahFlags = {
    platform: boolean;
    writes: boolean;
    memory: boolean;
    multimodal: boolean;
    monitors: boolean;
};

type SabahEnvironment = Record<string, string | undefined>;

function isEnabled(environment: SabahEnvironment, key: string): boolean {
    return environment[key] === "true";
}

export function parseSabahFlags(environment: SabahEnvironment = process.env): SabahFlags {
    return {
        platform: isEnabled(environment, "SABAH_PLATFORM_ENABLED"),
        writes: isEnabled(environment, "SABAH_WRITES_ENABLED"),
        memory: isEnabled(environment, "SABAH_MEMORY_ENABLED"),
        multimodal: isEnabled(environment, "SABAH_MULTIMODAL_ENABLED"),
        monitors: isEnabled(environment, "SABAH_MONITORS_ENABLED"),
    };
}

export function getSabahFlags(): SabahFlags {
    return parseSabahFlags(process.env);
}
