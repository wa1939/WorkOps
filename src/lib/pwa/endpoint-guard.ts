import { isIP } from "node:net";

const APPROVED_EXACT_HOSTS = new Set(["fcm.googleapis.com"]);
const APPROVED_SUFFIXES = ["google.com", "android.com", "push.apple.com", "mozilla.com"];

function isSubdomainOf(hostname: string, domain: string): boolean {
    return hostname.length > domain.length + 1 && hostname.endsWith(`.${domain}`);
}

/**
 * Returns true only for HTTPS push endpoints hosted by an approved provider.
 * This is deliberately a pure syntactic guard: the route never fetches the URL.
 */
export function isApprovedPushEndpoint(value: string | URL): boolean {
    let endpoint: URL;
    try {
        endpoint = value instanceof URL ? new URL(value.toString()) : new URL(value);
    } catch {
        return false;
    }

    if (endpoint.protocol !== "https:") {
        return false;
    }

    const hostname = endpoint.hostname.toLowerCase().replace(/\.$/, "");
    const ipLiteral = hostname.replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || isIP(ipLiteral) !== 0) {
        return false;
    }

    return APPROVED_EXACT_HOSTS.has(hostname)
        || APPROVED_SUFFIXES.some((suffix) => isSubdomainOf(hostname, suffix));
}
