import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import { randomBytes } from "node:crypto";
import { hashAuthToken } from "@/lib/auth-token-hash";
import { EMAIL_RATE_LIMIT, RESET_IP_RATE_LIMIT, checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/rate-limit/request";
import { z } from "zod";

const forgotPasswordSchema = z.object({
    email: z.string().email("Invalid email address"),
});

const successMessage = "If an account exists for that email, we've sent a password reset link.";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { email } = forgotPasswordSchema.parse(body);
        const normalizedEmail = email.trim().toLowerCase();

        // Rate-limit by IP BEFORE the account lookup so unknown and known
        // emails are indistinguishable (no account-existence oracle) and both
        // receive identical responses and status codes.
        const clientIp = getClientIp(request.headers);
        const ipRate = await checkRateLimit(
            `reset-ip:${clientIp ?? "unknown"}`,
            RESET_IP_RATE_LIMIT.limit,
            RESET_IP_RATE_LIMIT.windowSec,
        );
        if (!ipRate.allowed) {
            const response = NextResponse.json(
                { error: "Too many password reset requests. Please try again later." },
                { status: 429 },
            );
            response.headers.set("Retry-After", String(ipRate.retryAfterSec));
            return response;
        }

        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true, email: true },
        });

        if (user) {
            const rate = await checkRateLimit(
                `email:${user.id}`,
                EMAIL_RATE_LIMIT.limit,
                EMAIL_RATE_LIMIT.windowSec,
            );
            if (!rate.allowed) {
                // Identical shape/status to the success path: the client must
                // not learn whether the limit tripped for this account.
                return NextResponse.json({ success: true, message: successMessage });
            }

            const token = randomBytes(32).toString("hex");
            const tokenHash = hashAuthToken(token);
            const expires = new Date(Date.now() + 60 * 60 * 1000);

            await prisma.passwordResetToken.deleteMany({
                where: { identifier: normalizedEmail },
            });

            await prisma.passwordResetToken.create({
                data: {
                    identifier: normalizedEmail,
                    // Keep the required legacy column populated without storing
                    // the raw token. Legacy rows have tokenHash set to null.
                    token: tokenHash,
                    tokenHash,
                    expires,
                    usedAt: null,
                },
            });

            await sendPasswordResetEmail(normalizedEmail, token);
        }

        return NextResponse.json({
            success: true,
            message: successMessage,
        });
    } catch (error) {
        console.error("Forgot password error:", error);

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: error.errors[0].message },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { error: "Failed to process password reset request" },
            { status: 500 }
        );
    }
}
