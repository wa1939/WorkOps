/** Return whether a JWT carries the currently persisted password version. */
export function isPasswordVersionCurrent(
    tokenVersion: unknown,
    databaseVersion: unknown
): boolean {
    return (
        typeof tokenVersion === "number" &&
        Number.isSafeInteger(tokenVersion) &&
        tokenVersion >= 0 &&
        typeof databaseVersion === "number" &&
        Number.isSafeInteger(databaseVersion) &&
        databaseVersion >= 0 &&
        tokenVersion === databaseVersion
    );
}
