/** Explicit deployment policy for manually entered email recipients. Empty is fail-closed. */
export function parseInternalDomains(raw: string | undefined): string[] {
    if (!raw) return [];
    const domain = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
    return Array.from(new Set(raw.split(/[,;\s]+/)
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length <= 253 && domain.test(value))));
}

/** Server callers read the current deployment setting; no organization is implicitly trusted. */
export function configuredInternalDomains(): string[] {
    return parseInternalDomains(process.env.COMMUNICATION_INTERNAL_DOMAINS);
}
