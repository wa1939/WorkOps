// Pure validation for the first-admin bootstrap input. No I/O.

export type AdminInput = {
    email: string;
    name: string;
    password: string;
};

export type AdminValidationResult =
    | { ok: true; normalized: AdminInput }
    | { ok: false; errors: string[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;
const COMMON_PASSWORDS = new Set([
    "password123!",
    "password1234",
    "changeme123!",
    "administrator1",
    "qwerty123456",
    "letmein123456",
    "workops123456",
]);

export function validateAdminInput(raw: Partial<AdminInput>): AdminValidationResult {
    const errors: string[] = [];

    const email = String(raw.email ?? "").trim().toLowerCase();
    if (!email) errors.push("Email is required.");
    else if (!EMAIL_RE.test(email)) errors.push("Email does not look valid.");
    else if (email.length > 254) errors.push("Email is too long.");

    const name = String(raw.name ?? "").trim();
    if (name.length > 100) errors.push("Name must be 100 characters or fewer.");

    const password = String(raw.password ?? "");
    if (password.length < MIN_PASSWORD_LENGTH) {
        errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    } else if (password.length > MAX_PASSWORD_LENGTH) {
        errors.push(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
    } else if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        errors.push("Password must contain both letters and digits.");
    } else if (COMMON_PASSWORDS.has(password.toLowerCase())) {
        errors.push("Password is too common. Choose a unique password.");
    } else {
        const emailLocal = email.split("@")[0] ?? "";
        if (emailLocal.length >= 4 && password.toLowerCase().includes(emailLocal.toLowerCase())) {
            errors.push("Password must not contain your email name.");
        }
    }

    if (errors.length > 0) return { ok: false, errors };
    return {
        ok: true,
        normalized: {
            email,
            name: name || "WorkOps Admin",
            password,
        },
    };
}
