import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { hashAuthToken, matchResetToken } from "@/lib/auth-token-hash";
import { checkRateLimit, RESET_RATE_LIMIT } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/rate-limit/request";
import { z } from "zod";

const resetPasswordSchema = z.object({
    token: z.string().min(1, "Reset token is required"),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

const invalidTokenResponse = () =>
    NextResponse.json(
        { error: "Invalid or expired reset token" },
        { status: 400 }
    );

export async function POST(request: Request) {
    try {
        const clientIp = getClientIp(request.headers) ?? "unknown";
        const rate = await checkRateLimit(
            `reset:${clientIp}`,
            RESET_RATE_LIMIT.limit,
            RESET_RATE_LIMIT.windowSec,
        );
        if (!rate.allowed) {
            const response = NextResponse.json(
                { error: "Too many requests. Please try again later." },
                { status: 429 },
            );
            response.headers.set("Retry-After", String(rate.retryAfterSec));
            return response;
        }

        const body = await request.json();
        const { token, password } = resetPasswordSchema.parse(body);
        const now = new Date();
        const tokenHash = hashAuthToken(token);

        let resetIdentifier: string | null = null;

        // Find the hash row first. The updateMany is the one-use claim: only
        // one concurrent request can change a fresh, unexpired row.
        const hashedCandidate = await prisma.passwordResetToken.findFirst({
            where: { tokenHash },
            select: { identifier: true },
        });
        if (hashedCandidate) {
            const claimed = await prisma.passwordResetToken.updateMany({
                where: {
                    tokenHash,
                    usedAt: null,
                    expires: { gt: now },
                },
                data: { usedAt: now },
            });
            if (claimed.count === 1) {
                resetIdentifier = hashedCandidate.identifier;
            }
        } else {
            // Existing rows predate tokenHash and retain a plaintext token.
            // Compare that value in constant time, then migrate the row while
            // claiming it so the legacy path is also one-use.
            const legacyCandidate = await prisma.passwordResetToken.findUnique({
                where: { token },
                select: { identifier: true, token: true, tokenHash: true },
            });
            if (
                legacyCandidate &&
                matchResetToken(legacyCandidate, token) === "legacy"
            ) {
                const claimed = await prisma.passwordResetToken.updateMany({
                    where: {
                        token,
                        tokenHash: null,
                        usedAt: null,
                        expires: { gt: now },
                    },
                    data: {
                        // Scrub the legacy plaintext value after a successful
                        // fallback and retain the hash in both token columns
                        // during the compatibility window.
                        token: tokenHash,
                        tokenHash,
                        usedAt: now,
                    },
                });
                if (claimed.count === 1) {
                    resetIdentifier = legacyCandidate.identifier;
                }
            }
        }

        if (!resetIdentifier) {
            return invalidTokenResponse();
        }

        const user = await prisma.user.findUnique({
            where: { email: resetIdentifier },
            select: { id: true },
        });
        if (!user) {
            return invalidTokenResponse();
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        await prisma.$transaction([
            prisma.user.update({
                where: { id: user.id },
                data: {
                    password: hashedPassword,
                    passwordVersion: { increment: 1 },
                },
            }),
            // JWT sessions are stateless, but remove any adapter sessions that
            // may exist so this remains safe if the strategy changes later.
            prisma.session.deleteMany({ where: { userId: user.id } }),
        ]);

        return NextResponse.json({
            success: true,
            message: "Password reset successful. You can now sign in.",
        });
    } catch (error) {
        console.error("Reset password error:", error);

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: error.errors[0].message },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { error: "Failed to reset password" },
            { status: 500 }
        );
    }
}
