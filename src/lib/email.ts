import { Resend } from "resend";
import { requireAcceptedId, type ProviderResult } from "./communications/provider-outcome";

export type EmailSendOutcome = {
    accepted: boolean;
    providerId?: string;
    error?: string;
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function sendWithOutcome(send: () => Promise<ProviderResult>): Promise<EmailSendOutcome> {
    try {
        const response = await send();
        try {
            return { accepted: true, providerId: requireAcceptedId(response) };
        } catch (error) {
            return { accepted: false, error: errorMessage(error) };
        }
    } catch (error) {
        return { accepted: false, error: errorMessage(error) };
    }
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function getBaseUrl() {
    return (
        process.env.NEXTAUTH_URL ||
        process.env.APP_BASE_URL ||
        "http://localhost:3000"
    );
}

function getResend() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        throw new Error("Missing RESEND_API_KEY");
    }
    return new Resend(apiKey);
}

function getFromAddress() {
    return process.env.EMAIL_FROM || "WorkOps <noreply@resend.dev>";
}

// ---------------------------------------------------------------------------
// Shared email layout — table-based for maximum client compatibility
// ---------------------------------------------------------------------------

function emailLayout(options: {
    preheader: string;
    heading: string;
    body: string;
    ctaText?: string;
    ctaUrl?: string;
    footerNote?: string;
}): string {
    const { preheader, heading, body, ctaText, ctaUrl, footerNote } = options;
    const year = new Date().getFullYear();

    const ctaBlock = ctaText && ctaUrl
        ? `
        <tr>
            <td style="padding: 8px 0 24px 0;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                        <td style="border-radius: 8px; background-color: #7c3aed;">
                            <a href="${ctaUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                                ${ctaText}
                            </a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>`
        : "";

    const footerBlock = footerNote
        ? `<tr><td class="email-muted" style="padding: 0 0 16px 0; font-size: 13px; line-height: 20px; color: #6b7280;">${footerNote}</td></tr>`
        : "";

    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>WorkOps</title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
    <style>
        :root { color-scheme: light dark; supported-color-schemes: light dark; }
        body, table, td { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        body { margin: 0; padding: 0; width: 100%; background-color: #f3f4f6; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
        a { color: #7c3aed; text-decoration: none; }
        a:hover { text-decoration: underline; }
        @media only screen and (max-width: 620px) {
            .email-container { width: 100% !important; max-width: 100% !important; }
            .email-content { padding: 24px 16px !important; }
            .responsive-img { width: 100% !important; height: auto !important; }
        }
        @media (prefers-color-scheme: dark) {
            body { background-color: #1a1a2e !important; }
            .email-wrapper { background-color: #1a1a2e !important; }
            .email-body { background-color: #16213e !important; border-color: #2a2a4a !important; }
            .email-heading { color: #e2e8f0 !important; }
            .email-text { color: #cbd5e1 !important; }
            .email-muted { color: #94a3b8 !important; }
            .email-card { background-color: #1e293b !important; border-color: #334155 !important; }
            .email-card-text { color: #e2e8f0 !important; }
            .email-logo-text { color: #e2e8f0 !important; }
            .email-footer { color: #64748b !important; }
            .email-footer a { color: #a78bfa !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6;">
    <!-- Preheader (hidden preview text) -->
    <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
        ${preheader}
        ${"&nbsp;&zwnj;".repeat(30)}
    </div>

    <!-- Email wrapper -->
    <table class="email-wrapper" role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6;">
        <tr>
            <td align="center" style="padding: 32px 16px;">

                <!-- Email container -->
                <table class="email-container" role="presentation" border="0" cellpadding="0" cellspacing="0" width="560" style="max-width: 560px; width: 100%;">

                    <!-- Logo header -->
                    <tr>
                        <td align="center" style="padding: 0 0 24px 0;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); text-align: center; vertical-align: middle;">
                                        <span style="color: #ffffff; font-size: 20px; font-weight: 700; line-height: 44px;">C</span>
                                    </td>
                                    <td class="email-logo-text" style="padding-left: 12px; font-size: 18px; font-weight: 700; color: #1f2937;">
                                        WorkOps
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Email body card -->
                    <tr>
                        <td>
                            <table class="email-body" role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
                                <tr>
                                    <td class="email-content" style="padding: 40px 36px;">

                                        <!-- Heading -->
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td class="email-heading" style="padding: 0 0 20px 0; font-size: 22px; font-weight: 700; line-height: 30px; color: #111827;">
                                                    ${heading}
                                                </td>
                                            </tr>
                                        </table>

                                        <!-- Body content -->
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                            ${body}
                                            ${ctaBlock}
                                            ${footerBlock}
                                        </table>

                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td class="email-footer" align="center" style="padding: 24px 0 0 0; font-size: 12px; line-height: 18px; color: #9ca3af;">
                            <p style="margin: 0 0 8px 0;">&copy; ${year} WorkOps &mdash; Culture &amp; Employee Experience</p>
                            <p style="margin: 0;">
                                <a href="${getBaseUrl()}" style="color: #7c3aed;">Open WorkOps</a>
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

// Helper: creates a content row with text
function textRow(text: string, style?: string): string {
    const baseStyle = "padding: 0 0 16px 0; font-size: 15px; line-height: 24px; color: #374151;";
    return `<tr><td class="email-text" style="${baseStyle}${style || ""}">${text}</td></tr>`;
}

// Helper: creates a highlighted card block (for task titles, etc.)
function highlightCard(content: string, variant: "purple" | "amber" | "red" = "purple"): string {
    const colors = {
        purple: { bg: "#f5f3ff", border: "#7c3aed" },
        amber: { bg: "#fffbeb", border: "#f59e0b" },
        red: { bg: "#fef2f2", border: "#ef4444" },
    };
    const c = colors[variant];
    return `
    <tr>
        <td style="padding: 0 0 20px 0;">
            <table class="email-card" role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${c.bg}; border: 1px solid ${c.border}33; border-radius: 8px;">
                <tr>
                    <td class="email-card-text" style="padding: 16px 20px; font-size: 16px; font-weight: 600; line-height: 24px; color: #111827;">
                        ${content}
                    </td>
                </tr>
            </table>
        </td>
    </tr>`;
}

// Helper: plain text fallback link
function fallbackLink(url: string, label: string): string {
    return `<tr><td class="email-muted" style="padding: 0 0 8px 0; font-size: 13px; line-height: 20px; color: #6b7280;">Or copy this link: <a href="${url}" style="color: #7c3aed; word-break: break-all;">${url}</a></td></tr>`;
}

// ---------------------------------------------------------------------------
// Email functions
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(email: string, token: string) {
    const resend = getResend();
    const confirmUrl = `${getBaseUrl()}/verify-email?token=${token}`;

    const body = [
        textRow("Welcome to <strong>WorkOps</strong>! We're excited to have you on board."),
        textRow("Please verify your email address by clicking the button below to get started:"),
    ].join("");

    return sendWithOutcome(() => resend.emails.send({
        from: getFromAddress(),
        to: email,
        subject: "Verify your email - WorkOps",
        html: emailLayout({
            preheader: "Please verify your email to get started with WorkOps.",
            heading: "Verify Your Email",
            body,
            ctaText: "Verify Email Address",
            ctaUrl: confirmUrl,
            footerNote: "This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.",
        }),
    }));
}

export async function sendTaskAssignmentEmail(
    email: string,
    assigneeName: string,
    taskTitle: string,
    taskUrl: string
) {
    const resend = getResend();
    const fullUrl = `${getBaseUrl()}${taskUrl}`;

    const body = [
        textRow(`Hi ${escapeHtml(assigneeName)},`),
        textRow("You have been assigned to a new task:"),
        highlightCard(escapeHtml(taskTitle), "purple"),
        textRow("Open the task to see the full details, set reminders, and collaborate with your team."),
    ].join("");

    return sendWithOutcome(() => resend.emails.send({
        from: getFromAddress(),
        to: email,
        subject: `New Task: ${taskTitle.length > 50 ? taskTitle.substring(0, 50) + "..." : taskTitle}`,
        html: emailLayout({
            preheader: `You've been assigned: "${taskTitle}"`,
            heading: "New Task Assigned",
            body,
            ctaText: "View Task",
            ctaUrl: fullUrl,
        }),
    }));
}

export async function sendTaskReminderEmail(
    email: string,
    name: string,
    taskTitle: string,
    taskUrl: string,
    timeUntilDue: string
) {
    const resend = getResend();
    const fullUrl = `${getBaseUrl()}${taskUrl}`;

    const isOverdue = timeUntilDue.includes("overdue");
    const variant = isOverdue ? "red" as const : "amber" as const;
    const urgencyLabel = isOverdue ? "This task is overdue" : `This task is due ${escapeHtml(timeUntilDue)}`;

    const body = [
        textRow(`Hi ${escapeHtml(name)},`),
        textRow(`${urgencyLabel}. Please review and take action:`),
        highlightCard(escapeHtml(taskTitle), variant),
    ].join("");

    return sendWithOutcome(() => resend.emails.send({
        from: getFromAddress(),
        to: email,
        subject: `${isOverdue ? "Overdue" : "Reminder"}: ${taskTitle.length > 50 ? taskTitle.substring(0, 50) + "..." : taskTitle}`,
        html: emailLayout({
            preheader: `${urgencyLabel}: "${taskTitle}"`,
            heading: isOverdue ? "Task Overdue" : "Task Reminder",
            body,
            ctaText: "View Task",
            ctaUrl: fullUrl,
        }),
    }));
}

export type PmoOwnerReminderEmailInput = {
    email: string;
    ownerName: string;
    actionTitle: string;
    parentName: string;
    dueLabel: string;
    taskUrl: string;
    idempotencyKey: string;
};

export async function sendPmoOwnerReminderEmail(input: PmoOwnerReminderEmailInput): Promise<{ id: string }> {
    const resend = getResend();
    const fullUrl = `${getBaseUrl()}${input.taskUrl}`;
    const body = [textRow(`Hi ${escapeHtml(input.ownerName)},`), textRow(`You need to follow up on this external action (${escapeHtml(input.dueLabel)}):`), highlightCard(escapeHtml(input.actionTitle), input.dueLabel === "overdue" ? "red" : "amber"), textRow(`Parent: ${escapeHtml(input.parentName)}`)].join("");
    const outcome = await sendWithOutcome(() => resend.emails.send(
        { from: getFromAddress(), to: input.email, subject: `PMO follow-up: ${input.actionTitle}`, html: emailLayout({ preheader: `PMO owner follow-up ${input.dueLabel}`, heading: "External Action Follow-up", body, ctaText: "Review Follow-up Draft", ctaUrl: fullUrl }) },
        { idempotencyKey: input.idempotencyKey },
    ));
    const providerId = outcome.providerId;
    if (!outcome.accepted || !providerId) {
        throw new Error(outcome.error ?? "Resend did not return a delivery ID");
    }
    return { id: providerId, ...outcome };
}

export type SundayDigestResult =
    | { skipped: true; reason: "no recipients" }
    | ({ skipped: false; id: string | null; recipients: string[] } & EmailSendOutcome);

export async function sendSundayDigest(options: {
    to: string[];
    bullets: string[];
    weekLabel: string;
    reportId: string;
}): Promise<SundayDigestResult> {
    const { to, bullets, weekLabel, reportId } = options;
    if (to.length === 0) return { skipped: true, reason: "no recipients" as const };
    const resend = getResend();
    const reportUrl = `${getBaseUrl()}/reports/${reportId}`;

    // The digest lines are full prose sentences (GM's own voice). Render them as
    // paragraphs, right-aligned when the content is Arabic.
    const rtl = /[؀-ۿ]/.test(bullets.join(""));
    const align = rtl ? "right" : "left";
    const direction = rtl ? "rtl" : "ltr";

    const bulletHtml = bullets
        .map(
            (b) => `
        <tr>
            <td style="padding: 0 0 12px 0; font-size: 15px; line-height: 26px; color: #111827; vertical-align: top; direction: ${direction}; text-align: ${align};">
                <span class="email-card-text">${escapeHtml(b)}</span>
            </td>
        </tr>`,
        )
        .join("");

    const body = [
        textRow(`Weekly executive digest for ${escapeHtml(weekLabel)}.`),
        `<tr><td style="padding: 0 0 20px 0;"><table class="email-card" role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px;"><tr><td style="padding: 20px 24px;"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">${bulletHtml}</table></td></tr></table></td></tr>`,
        textRow("Open the full report for the detailed breakdown by workstream, project progress, and KPIs at risk."),
    ].join("");

    const preview = bullets.slice(0, 2).join(" · ").substring(0, 140);

    const outcome = await sendWithOutcome(() => resend.emails.send({
        from: getFromAddress(),
        to,
        subject: `Sunday Digest — ${weekLabel}`,
        html: emailLayout({
            preheader: preview,
            heading: `Sunday Digest — ${escapeHtml(weekLabel)}`,
            body,
            ctaText: "View Full Report",
            ctaUrl: reportUrl,
            footerNote: "Sent automatically each Sunday morning. Adjust recipients in Admin → Settings → Reporting.",
        }),
    }));

    return { skipped: false as const, id: outcome.providerId ?? null, recipients: to, ...outcome };
}

export async function sendCloseNudgeEmail(input: {
    email: string;
    name: string;
    title: string;
    body: string;
}) {
    const resend = getResend();
    return sendWithOutcome(() => resend.emails.send({
        from: getFromAddress(),
        to: input.email,
        subject: input.title,
        html: emailLayout({
            preheader: input.title,
            heading: input.title,
            body: textRow(escapeHtml(input.body)),
            ctaText: "افتح صباح وسجّل أسبوعك",
            ctaUrl: `${getBaseUrl()}/?sabah=record-week`,
            footerNote: "وصلك هذا التذكير لأنه ما فيه أي مهمة مغلقة باسمك هذا الأسبوع.",
        }),
    }));
}

export async function sendPasswordResetEmail(email: string, token: string) {
    const resend = getResend();
    const resetUrl = `${getBaseUrl()}/reset-password?token=${token}`;

    const body = [
        textRow("We received a request to reset the password for your account."),
        textRow("Click the button below to choose a new password:"),
    ].join("");

    return sendWithOutcome(() => resend.emails.send({
        from: getFromAddress(),
        to: email,
        subject: "Reset your password - WorkOps",
        html: emailLayout({
            preheader: "You requested a password reset for your WorkOps account.",
            heading: "Reset Your Password",
            body,
            ctaText: "Reset Password",
            ctaUrl: resetUrl,
            footerNote: "This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password will not be changed.",
        }),
    }));
}
