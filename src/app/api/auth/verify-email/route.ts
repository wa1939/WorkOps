import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
    try {
        const { token } = await request.json();

        if (!token) {
            return NextResponse.json(
                { error: "Token is required" },
                { status: 400 }
            );
        }

        // Find the verification token
        const verificationToken = await prisma.verificationToken.findFirst({
            where: {
                token,
                expires: { gt: new Date() },
            },
        });

        if (!verificationToken) {
            return NextResponse.json(
                { error: "Invalid or expired token" },
                { status: 400 }
            );
        }

        // Update user as verified
        await prisma.user.update({
            where: { email: verificationToken.identifier },
            data: { emailVerified: new Date() },
        });

        // Delete the token
        await prisma.verificationToken.delete({
            where: {
                identifier_token: {
                    identifier: verificationToken.identifier,
                    token: verificationToken.token,
                },
            },
        });

        return NextResponse.json({
            success: true,
            message: "Email verified successfully! You can now log in.",
        });
    } catch (error) {
        console.error("Verify error:", error);
        return NextResponse.json(
            { error: "Failed to verify email" },
            { status: 500 }
        );
    }
}
