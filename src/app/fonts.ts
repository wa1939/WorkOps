/**
 * WorkOps type identity: the platform system type stack.
 *
 * No webfont binaries and no network font dependencies. The stack is chosen
 * for polished Latin rendering with Arabic-script coverage across platforms:
 * system-ui resolves to Segoe UI (Windows), San Francisco (Apple platforms)
 * and Roboto (Android); Noto Sans / Noto Sans Arabic cover Linux and provide
 * an explicit Arabic fallback everywhere else.
 *
 * This replaces the previously locally-hosted Thmanyah Sans webfont, whose
 * redistribution license was never demonstrated. The font binaries are being
 * untracked from the repository and nothing here may reference them.
 */
export const SYSTEM_FONT_STACK =
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Noto Sans Arabic", sans-serif';
