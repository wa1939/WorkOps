export type HeaderReader = {
    get(name: string): string | null;
};

/** Return the first proxy-reported client address, when available. */
export function getClientIp(headers: HeaderReader): string | null {
    const forwardedFor = headers.get("x-forwarded-for");
    const firstHop = forwardedFor?.split(",", 1)[0]?.trim();
    if (firstHop) return firstHop;

    const realIp = headers.get("x-real-ip")?.trim();
    return realIp || null;
}
