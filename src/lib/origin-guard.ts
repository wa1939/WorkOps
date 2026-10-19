const invalidOriginMessage = "Invalid request origin";

export class OriginGuardError extends Error {
    readonly code = "ORIGIN_MISMATCH";
    readonly status = 403;

    constructor() {
        super(invalidOriginMessage);
        this.name = "OriginGuardError";
    }
}

function addHost(hosts: Set<string>, value: string | null): void {
    if (!value) return;

    const normalized = value.trim().toLowerCase();
    if (normalized) hosts.add(normalized);
}

function requestHosts(request: Request): Set<string> {
    const hosts = new Set<string>();
    const host = request.headers.get("host");
    const forwardedHost = request.headers.get("x-forwarded-host");

    addHost(hosts, host);
    forwardedHost
        ?.split(",")
        .forEach((forwardedValue) => addHost(hosts, forwardedValue));

    // Request.url is a useful fallback for tests and runtimes that omit Host,
    // but an explicitly supplied host header remains authoritative.
    if (hosts.size === 0) {
        try {
            addHost(hosts, new URL(request.url).host);
        } catch {
            // Request.url is normally absolute; no candidate means rejection.
        }
    }

    return hosts;
}

/**
 * Assert that a browser-supplied Origin belongs to this request host.
 * Requests without Origin are allowed for native clients and server jobs.
 */
export function assertSameOrigin(request: Request): void {
    const originHeader = request.headers.get("origin");
    if (originHeader === null) return;
    if (!originHeader.trim()) throw new OriginGuardError();

    let origin: URL;
    try {
        origin = new URL(originHeader);
    } catch {
        throw new OriginGuardError();
    }

    if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password) {
        throw new OriginGuardError();
    }

    if (!requestHosts(request).has(origin.host.toLowerCase())) {
        throw new OriginGuardError();
    }
}

type GuardedHandler<TRequest extends Request, TArgs extends unknown[]> = (
    request: TRequest,
    ...args: TArgs
) => Response | Promise<Response>;

/**
 * Wrap a state-changing route handler with an origin check.
 * Origin failures become a non-descriptive 403 response; handler errors pass
 * through unchanged so application error handling remains authoritative.
 */
export function withOriginGuard<TRequest extends Request, TArgs extends unknown[]>(
    handler: GuardedHandler<TRequest, TArgs>,
): GuardedHandler<TRequest, TArgs> {
    return async (request, ...args) => {
        try {
            assertSameOrigin(request);
        } catch (error) {
            if (!(error instanceof OriginGuardError)) throw error;

            return new Response(JSON.stringify({ error: invalidOriginMessage }), {
                status: error.status,
                headers: { "content-type": "application/json" },
            });
        }

        return handler(request, ...args);
    };
}
