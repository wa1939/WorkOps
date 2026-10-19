// Masks credentials in a connection string so CLIs can echo the target
// without ever printing a password.

export function maskDatabaseUrl(rawUrl: string): string {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.password) parsed.password = "***";
        // Some providers put credentials in the username; mask that too
        // only when it looks like it could be sensitive is overkill —
        // usernames are not secrets, keep them visible for debugging.
        return parsed.toString();
    } catch {
        return "<unparseable database url>";
    }
}

export function describeDatabaseTarget(rawUrl: string): string {
    try {
        const parsed = new URL(rawUrl);
        const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || "(default)";
        return `${parsed.hostname}:${parsed.port || "(default)"} database=${database}`;
    } catch {
        return "<unparseable database url>";
    }
}
